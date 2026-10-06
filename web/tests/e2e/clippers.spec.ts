import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { signIn } from "./auth";

/*
 * The Clippers page: public, and nobody is on it without asking and being approved. The first
 * tests always run; approving needs the e2e user to be an admin (E2E_ADMIN=1, with the server's
 * BAMIO_SUPERADMINS naming it: see admin.spec.ts).
 */

const sql = postgres(process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/bamio", { onnotice: () => undefined, max: 2 });
test.afterAll(() => sql.end());
const userId = (page: Page) => page.evaluate(() => (window as unknown as { Clerk: { user: { id: string } } }).Clerk.user.id);
const NAME = "Bamio E2E Clipper";

test("the Clippers page is public, and invites clippers to add themselves", async ({ page }) => {
  const res = await page.goto("/clippers");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "meet the clippers." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Add yourself" })).toHaveAttribute("href", "/profile/clippers");
  // Signed out, the profile asks for a sign-in first.
  await page.getByRole("link", { name: "Add yourself" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test.describe("a clipper's card", () => {
  let id = "";
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    id = await userId(page);
    await sql`delete from clipper_profiles where user_id = ${id}`;
  });
  test.afterEach(async () => {
    if (id) await sql`delete from clipper_profiles where user_id = ${id}`;
  });

  test("waits for a look before it shows, and comes down when turned off", async ({ page }) => {
    await page.goto("/profile/clippers");
    await expect(page.getByRole("heading", { name: "Clippers page" })).toBeVisible();
    await page.getByRole("switch", { name: "Show me on the Clippers page" }).check();
    await page.getByLabel("Name on your card").fill(NAME);
    await page.getByLabel("A line about you").fill("I clip test patterns into shorts.");
    // Only channels on platforms Bamio knows.
    await page.getByLabel("Your channel").fill("https://example.com/me");
    await page.getByRole("button", { name: "Ask to be listed" }).click();
    await expect(page.getByText("Use a link to your channel on YouTube, Twitch, Kick, TikTok, Instagram or X.")).toBeVisible();
    await page.getByLabel("Your channel").fill("twitch.tv/bamio_e2e");
    await page.getByRole("button", { name: "Ask to be listed" }).click();
    await expect(page.getByText("Waiting for a look")).toBeVisible();
    expect(await sql`select status, link from clipper_profiles where user_id = ${id}`).toMatchObject([{ status: "pending", link: "https://twitch.tv/bamio_e2e" }]);

    // Not public yet.
    await page.goto("/clippers");
    await expect(page.getByRole("heading", { name: NAME })).toHaveCount(0);

    // Off again: the entry is gone.
    await page.goto("/profile/clippers");
    await page.getByRole("switch", { name: "Show me on the Clippers page" }).uncheck();
    await page.getByRole("button", { name: "Take me off the page" }).click();
    await expect(page.getByText("You’re off the Clippers page")).toBeVisible();
    expect((await sql`select 1 from clipper_profiles where user_id = ${id}`).length).toBe(0);
  });

  test("shows once an admin approves it, and goes back for a look when changed", async ({ page }) => {
    test.skip(!process.env.E2E_ADMIN, "Set E2E_ADMIN=1, with the server's BAMIO_SUPERADMINS naming the e2e user.");
    await page.goto("/profile/clippers");
    await page.getByRole("switch", { name: "Show me on the Clippers page" }).check();
    await page.getByLabel("Name on your card").fill(NAME);
    await page.getByLabel("A line about you").fill("I clip test patterns into shorts.");
    await page.getByLabel("Your channel").fill("twitch.tv/bamio_e2e");
    await page.getByRole("button", { name: "Ask to be listed" }).click();
    await expect(page.getByText("Waiting for a look")).toBeVisible();

    await page.goto("/admin/clippers");
    const row = page.getByRole("row").filter({ hasText: NAME });
    await expect(row.getByText("Waiting", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Approve" }).click();
    await expect(row.getByText("On the page")).toBeVisible();

    await page.goto("/clippers");
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: NAME }) });
    await expect(card.getByText("I clip test patterns into shorts.")).toBeVisible();
    const channel = card.getByRole("link", { name: /bamio_e2e/ });
    await expect(channel).toHaveAttribute("href", "https://twitch.tv/bamio_e2e");
    await expect(channel).toHaveAttribute("rel", /nofollow/);
    await page.screenshot({ path: "qa/clippers/clippers.png", fullPage: true });

    // Its owner sees it's live; a change takes it off the page until it's looked at again.
    await page.goto("/profile/clippers");
    await expect(page.getByText("You’re on the Clippers page")).toBeVisible();
    await page.getByLabel("A line about you").fill("Now with different words.");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Waiting for a look")).toBeVisible();
    await page.goto("/clippers");
    await expect(page.getByRole("heading", { name: NAME })).toHaveCount(0);

    // Hidden by an admin: its owner is told.
    await page.goto("/admin/clippers");
    await page.getByRole("row").filter({ hasText: NAME }).getByRole("button", { name: "Hide" }).click();
    await expect(page.getByRole("row").filter({ hasText: NAME }).getByText("Hidden", { exact: true })).toBeVisible();
    await page.goto("/profile/clippers");
    await expect(page.getByText("Your card isn’t shown")).toBeVisible();
  });
});
