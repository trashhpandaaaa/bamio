import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/* The landing page's link field and upload button hand over to the import page. */

test.describe("landing page", () => {
  test.beforeEach(async ({ page }) => {
    // The import page looks the link up as soon as it has one; answer here so no site is contacted.
    await page.route("**/api/sources/inspect", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "test", message: "Not looked up in this test." } }) }),
    );
    await signIn(page);
  });

  test("the link field opens the import page with the link filled in", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Bamio home" }).first().locator(".tittle")).toBeVisible(); // the 9:16 frame i-dot
    await expect(page.getByRole("heading", { name: "AI that finds the moment, not just a clip." })).toBeVisible();
    const form = page.locator("#hero-link");
    await form.getByRole("button", { name: "Get clips" }).click();
    await expect(form.getByRole("alert")).toHaveText(/Paste a link to a video first/);
    await form.getByLabel("Video link").fill("not a link");
    await form.getByRole("button", { name: "Get clips" }).click();
    await expect(form.getByRole("alert")).toHaveText(/doesn’t look like a link/);

    // Without https:// is fine.
    await form.getByLabel("Video link").fill("youtube.com/watch?v=jNQXAC9IVRw");
    await form.getByRole("button", { name: "Get clips" }).click();
    await page.waitForURL(/\/new\?url=/);
    await expect(page.getByLabel("Video link")).toHaveValue("https://youtube.com/watch?v=jNQXAC9IVRw");
    await expect(page.getByText("Not looked up in this test.")).toBeVisible();
  });

  test("the bar that follows the page appears after the hero, and upload opens the upload tab", async ({ page }) => {
    await page.goto("/");
    // Hero, closing panel, then the bar (last in the page; hidden ones count too).
    const bar = page.getByRole("form", { name: "Get clips from a video link", includeHidden: true }).last();
    await expect(bar).toBeHidden();
    await page.locator("#captions").scrollIntoViewIfNeeded();
    await expect(bar).toBeVisible();
    await page.locator("#get-started").scrollIntoViewIfNeeded();
    await expect(bar).toBeHidden();

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("link", { name: "Upload a file" }).click();
    await page.waitForURL(/\/new\?mode=upload/);
    await expect(page.getByRole("button", { name: "Upload a file" })).toHaveAttribute("aria-pressed", "true");
  });
});

test("the demos play stock footage, and show stills to visitors who want less motion", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator("#main figure").first();
  const playing = () => hero.locator("video").evaluateAll((videos) => videos.some((v) => !(v as HTMLVideoElement).paused && (v as HTMLVideoElement).currentTime > 0.2));
  await expect.poll(playing, { timeout: 20_000 }).toBe(true);
  // Footage off screen isn't playing (or even loaded).
  await expect(page.locator("#languages video")).toHaveCount(0);
  // The gaming clip reel plays once it's scrolled to, each clip with its caption.
  const reel = page.getByRole("list", { name: "Example clips from gaming streams" });
  await reel.scrollIntoViewIfNeeded();
  await expect(reel.getByRole("listitem")).toHaveCount(6);
  await expect
    .poll(() => reel.locator("video").evaluateAll((videos) => videos.filter((v) => !(v as HTMLVideoElement).paused && (v as HTMLVideoElement).currentTime > 0.2).length), { timeout: 20_000 })
    .toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(hero.locator("img").first()).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.locator("video")).toHaveCount(0);
});
