import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { SAMPLE_VIDEO, signIn } from "./auth";

/*
 * Plans switched on: importing needs a plan, and uses its AI minutes. Gives the e2e user a
 * plan by writing its billing record the way checkout and webhooks would (read from Stripe
 * just now, so the server doesn't ask Stripe again), and removes it afterwards (in the test
 * server's database: DATABASE_URL, or the local one). Opt-in, with
 * the test server started with a fake Stripe key (it overrides a real one in web/.env, so no
 * request reaches a real Stripe account; Stripe refuses the fake key, and the test expects that):
 *   STRIPE_SECRET_KEY=sk_test_e2e_fake BAMIO_AI_MOCK=1 npx next start -p 3100
 *   E2E_BILLING=1 npx playwright test billing
 * (A test server Playwright starts itself gets the fake key automatically.)
 */
test.skip(!process.env.E2E_BILLING, "Set E2E_BILLING=1, with the test server started with STRIPE_SECRET_KEY set.");

const sql = postgres(process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/bamio", { onnotice: () => undefined, max: 2 });
test.afterAll(() => sql.end());
const userId = (page: Page) => page.evaluate(() => (window as unknown as { Clerk: { user: { id: string } } }).Clerk.user.id);

async function setPlan(id: string, plan: "starter" | "pro" | null, usedSec = 0) {
  const now = Date.now();
  const subscription = plan ? { id: "sub_e2e", status: "active", plan, interval: "month", anchor: now - 86400_000, periodEnd: now + 29 * 86400_000, cancelAt: null, checkedAt: now } : undefined;
  await clearPlan(id);
  await sql`insert into billing_accounts (user_id, data, updated_at) values (${id}, ${sql.json(subscription ? { customerId: "cus_e2e", subscription } : { customerId: "cus_e2e" })}, ${now})`;
  if (usedSec > 0) await sql`insert into usage_entries (user_id, key, sec, at) values (${id}, 'e2e-earlier', ${usedSec}, ${now - 3600_000})`;
}

async function clearPlan(id: string) {
  await sql`delete from plan_grants where user_id = ${id}`;
  await sql`delete from billing_accounts where user_id = ${id}`;
  await sql`delete from usage_entries where user_id = ${id}`;
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

  test("a plan given for free works and shows as free", async ({ page }) => {
    await clearPlan(id);
    await sql`insert into plan_grants (user_id, plan, note, created_at) values (${id}, ${"pro"}, ${"e2e"}, ${Date.now()})`;
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "Pro" })).toBeVisible();
    await expect(page.getByText("Free", { exact: true })).toBeVisible();
    await expect(page.getByText("Given to your account, free of charge.")).toBeVisible();
    await expect(page.getByText("400", { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: "qa/billing/granted.png", fullPage: true });
    await page.goto("/new");
    await expect(page.getByText("Choose a plan to import videos")).toHaveCount(0);
  });

  test("a friend's link is kept, recorded at checkout, and everyone has a link to share", async ({ page, context }) => {
    const referrer = "user_e2e_referrer";
    const code = "e2etest2";
    await sql`delete from referrals where referred_user_id = ${id}`;
    await sql`insert into referral_codes (user_id, code, created_at) values (${referrer}, ${code}, ${Date.now()}) on conflict (user_id) do update set code = excluded.code`;
    try {
      await page.goto(`/r/${code}`);
      await expect(page).toHaveURL(/\/$/);
      expect((await context.cookies()).find((c) => c.name === "bamio_ref")?.value).toBe(code);

      // Going to checkout records it (Stripe then refuses this server's fake key).
      await setPlan(id, null);
      await page.goto("/pricing");
      await page.getByRole("button", { name: "Choose Starter" }).click();
      await expect(page.getByRole("alert").filter({ hasText: "Stripe refused this server’s key" })).toBeVisible();
      const rows = await sql<{ referrer_user_id: string; status: string }[]>`select referrer_user_id, status from referrals where referred_user_id = ${id}`;
      expect(rows).toEqual([{ referrer_user_id: referrer, status: "pending" }]);

      // Their own link, on Plan & billing.
      await page.goto("/billing#refer");
      const panel = page.getByRole("region", { name: /Get \$5 for every friend who subscribes/ });
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("textbox", { name: "Your referral link" })).toHaveValue(/\/r\/[2-9a-z]{8}$/);
      await expect(panel.getByText("No friends have used your link yet.")).toBeVisible();
      await page.screenshot({ path: "qa/billing/referral.png", fullPage: true });
    } finally {
      await sql`delete from referrals where referred_user_id = ${id}`;
      await sql`delete from referral_codes where user_id in (${referrer}, ${id})`;
    }
  });

  test("a new account's first video is free, up to 30 minutes", async ({ page }) => {
    test.setTimeout(5 * 60_000);
    await clearPlan(id);
    // The trial keeps one project at a time: start from none (a failed run may have left one).
    for (const p of (await (await page.request.get("/api/projects")).json()) as { id: string }[]) await page.request.delete(`/api/projects/${p.id}`);
    await page.goto("/new");
    await expect(page.getByText("Your first video is free")).toBeVisible();
    await expect(page.getByText("30 free minutes left.")).toBeVisible();
    await page.getByRole("button", { name: "Upload a file" }).click();
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByText("Uses about 1 of your 30 free minutes.")).toBeVisible();
    await page.screenshot({ path: "qa/billing/trial-import.png", fullPage: true });
    await page.getByRole("button", { name: "Import and find clips" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    const api = new URL(page.url()).pathname.replace("/projects/", "/api/projects/");
    try {
      await expect.poll(async () => ((await (await page.request.get(api)).json()) as { job: { status: string } }).job.status, { timeout: 180_000 }).toBe("ready");
      await page.goto("/billing");
      await expect(page.getByRole("heading", { name: "Your free trial" })).toBeVisible();
      await expect(page.getByText("29 of 30 minutes left")).toBeVisible(); // the 40 s sample counts as a minute
      await page.screenshot({ path: "qa/billing/trial-billing.png", fullPage: true });
      // One project at a time: the next import waits until this one is deleted (or a plan is chosen).
      const second = await page.request.post("/api/projects/upload", { data: { fileName: "b.mp4", size: 1000, findClips: false, clipLength: "short", language: "auto" } });
      expect(second.status()).toBe(409);
    } finally {
      expect((await page.request.delete(api)).status()).toBe(204);
    }
  });

  test("once the free video is used, importing waits for a plan", async ({ page }) => {
    await setPlan(id, null, 30 * 60);
    await page.goto("/new");
    await expect(page.getByText("You’ve used your free video")).toBeVisible();
    await page.getByRole("button", { name: "Upload a file" }).click();
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByRole("button", { name: "Import and find clips" })).toBeDisabled();

    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: "You’ve used your free video" })).toBeVisible();

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
