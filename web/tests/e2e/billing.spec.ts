import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_VIDEO, signIn } from "./auth";

/*
 * Plans switched on: importing needs a plan, and uses its AI minutes. Gives the e2e user a
 * plan by writing its billing files the way checkout and webhooks would (read from Stripe
 * just now, so the server doesn't ask Stripe again), and removes them afterwards. Opt-in, with
 * the test server started with any Stripe key (no payment is made; Stripe calls fail on a fake key):
 *   STRIPE_SECRET_KEY=sk_test_fake BAMIO_AI_MOCK=1 npx next start -p 3100
 *   E2E_BILLING=1 npx playwright test billing
 */
test.skip(!process.env.E2E_BILLING, "Set E2E_BILLING=1, with the test server started with STRIPE_SECRET_KEY set.");

const dataRoot = () => path.resolve(process.env.BAMIO_DATA_DIR || path.join(process.cwd(), ".data"));
const userId = (page: Page) => page.evaluate(() => (window as unknown as { Clerk: { user: { id: string } } }).Clerk.user.id);

async function setPlan(id: string, plan: "starter" | "pro" | null, usedSec = 0) {
  const dir = path.join(dataRoot(), "users", id);
  await mkdir(dir, { recursive: true });
  const now = Date.now();
  const subscription = plan ? { id: "sub_e2e", status: "active", plan, interval: "month", anchor: now - 86400_000, periodEnd: now + 29 * 86400_000, cancelAt: null, checkedAt: now } : undefined;
  await writeFile(path.join(dir, "billing.json"), JSON.stringify({ customerId: "cus_e2e", subscription }));
  await writeFile(path.join(dir, "usage.json"), JSON.stringify({ entries: usedSec > 0 ? [{ key: "e2e-earlier", sec: usedSec, at: now - 3600_000 }] : [] }));
}

async function clearPlan(id: string) {
  const dir = path.join(dataRoot(), "users", id);
  await rm(path.join(dir, "billing.json"), { force: true });
  await rm(path.join(dir, "usage.json"), { force: true });
}

test.describe("plans", () => {
  let id = "";
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    id = await userId(page);
  });
  test.afterEach(async () => {
    if (id) await clearPlan(id);
  });

  test("without a plan, importing waits for one", async ({ page }) => {
    await setPlan(id, null);
    await page.goto("/new");
    await expect(page.getByText("Choose a plan to import videos")).toBeVisible();
    await page.getByRole("button", { name: "Upload a file" }).click();
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByRole("button", { name: "Import and find clips" })).toBeDisabled();

    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "No plan yet" })).toBeVisible();

    // Buying goes to Stripe, which refuses this server's fake key; the page says so.
    await page.goto("/pricing");
    await page.getByRole("button", { name: "Choose Starter" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Stripe refused this server’s key" })).toBeVisible();
  });

  test("a plan's minutes are counted, and imports stop when they run out", async ({ page }) => {
    test.setTimeout(5 * 60_000);
    // Out of minutes: the server refuses the import, with a way to the plans.
    await setPlan(id, "starter", 150 * 60 - 10);
    await page.goto("/new");
    await expect(page.getByText(/0 AI minutes left this month/)).toBeVisible();
    await page.getByRole("button", { name: "Upload a file" }).click();
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_VIDEO);
    await page.getByRole("button", { name: "Import and find clips" }).click();
    const error = page.getByRole("alert").filter({ hasText: "You’ve used this month’s 150 AI minutes" });
    await expect(error).toBeVisible();
    await expect(error.getByRole("link", { name: "See plans" })).toHaveAttribute("href", "/pricing");

    // With minutes left, the import runs and its length is counted.
    await setPlan(id, "pro");
    await page.goto("/new");
    await expect(page.getByText(/400 AI minutes left this month/)).toBeVisible();
    await page.getByRole("button", { name: "Upload a file" }).click();
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_VIDEO);
    // The browser reads the file's length: what it will use.
    await expect(page.getByText("Uses about 1 of your 400 AI minutes left this month.")).toBeVisible();
    await page.getByRole("button", { name: "Import and find clips" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    const projectPath = new URL(page.url()).pathname;
    const api = projectPath.replace("/projects/", "/api/projects/");
    try {
      // Minutes are counted once the video is prepared (before captions and clips).
      await expect.poll(async () => ((await (await page.request.get(api)).json()) as { job: { status: string } }).job.status, { timeout: 180_000 }).toBe("ready");
      await page.goto("/billing");
      await expect(page.getByRole("heading", { name: "Pro" })).toBeVisible();
      await expect(page.getByText("Active", { exact: true })).toBeVisible();
      await expect(page.getByText("399 of 400 left")).toBeVisible(); // the 40 s sample counts as a minute used
      await expect(page.getByText(/of 150 kept/)).toBeVisible();
      await page.screenshot({ path: "qa/billing/billing-pro.png", fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: "qa/billing/billing-pro-390.png", fullPage: true });
      await page.setViewportSize({ width: 1440, height: 900 });

      // On Pricing, a subscriber's buttons switch plans in Stripe's billing portal.
      await page.goto("/pricing");
      const card = (name: string) => page.getByRole("article").filter({ has: page.getByRole("heading", { name }) });
      await expect(card("Pro").getByText("Your plan")).toBeVisible();
      await expect(card("Starter").getByRole("button", { name: "Switch to Starter" })).toBeVisible();
      await page.getByRole("button", { name: "Every 3 months" }).click();
      await expect(card("Pro").getByRole("button", { name: "Switch to every 3 months" })).toBeVisible();
      await page.getByRole("button", { name: "Monthly" }).click();
      await page.screenshot({ path: "qa/billing/pricing-pro.png", fullPage: true });
      await card("Team").getByRole("button", { name: "Upgrade to Team" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Stripe refused this server’s key" })).toBeVisible();
    } finally {
      expect((await page.request.delete(api)).status()).toBe(204);
    }
  });
});
