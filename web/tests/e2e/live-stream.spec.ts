import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

/*
 * Capturing from live streams, end to end. Opt-in, because it needs channels that are
 * live right now:
 *   E2E_LIVE_TWITCH=https://www.twitch.tv/<live channel>
 *   E2E_LIVE_YOUTUBE=https://www.youtube.com/watch?v=<live video>
 *   E2E_LIVE_KICK=https://kick.com/<live channel>
 *   npx playwright test live-stream
 */

async function startCapture(page: Page, url: string) {
  await signIn(page);
  await page.goto("/new");
  await page.getByLabel("Video link").fill(url);
  await expect(page.getByText("Live now")).toBeVisible({ timeout: 90_000 });
}

async function waitReady(page: Page) {
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  const api = new URL(page.url()).pathname.replace("/projects/", "/api/projects/");
  return api;
}

async function finish(page: Page, api: string, expectSeconds: [number, number]) {
  await expect(page.getByRole("heading", { name: /Clips/ })).toBeVisible({ timeout: 600_000 });
  const project = (await (await page.request.get(api)).json()) as {
    source: { durationSec: number; hasAudio?: boolean; live?: unknown };
    job: { status: string };
  };
  expect(project.job.status).toBe("ready");
  expect(project.source.live).toBeTruthy();
  expect(project.source.hasAudio).toBe(true);
  expect(project.source.durationSec).toBeGreaterThan(expectSeconds[0]);
  expect(project.source.durationSec).toBeLessThan(expectSeconds[1]);
  // The recording plays in the page.
  await expect.poll(() => page.locator("video").first().evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 30_000 }).toBeGreaterThan(0);
  expect((await page.request.delete(api)).status()).toBe(204);
}

test("Twitch: capture the last minute from the stream's VOD", async ({ page }) => {
  const url = process.env.E2E_LIVE_TWITCH;
  test.skip(!url, "Set E2E_LIVE_TWITCH to a live Twitch channel.");
  test.setTimeout(900_000);
  await startCapture(page, url!);
  await page.getByLabel("Start from").selectOption({ label: "1 min ago" });
  await page.getByLabel("Keep recording for").selectOption({ label: "Stop at now" });
  await expect(page.getByText("Captures the last 1 min.")).toBeVisible();
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const api = await waitReady(page);
  await finish(page, api, [45, 80]); // Twitch VOD segments are 10 s, so the cut is approximate
});

test("YouTube: capture the last minute from the stream's history", async ({ page }) => {
  const url = process.env.E2E_LIVE_YOUTUBE;
  test.skip(!url, "Set E2E_LIVE_YOUTUBE to a live YouTube stream with rewind (DVR) on.");
  test.setTimeout(900_000);
  await startCapture(page, url!);
  await page.getByLabel("Start from").selectOption({ label: "1 min ago" });
  await page.getByLabel("Keep recording for").selectOption({ label: "Stop at now" });
  await page.getByRole("button", { name: "Capture", exact: true }).click();
  const api = await waitReady(page);
  await finish(page, api, [55, 80]); // 1 min plus up to one 5 s segment
});

test("Kick: record from now and stop early", async ({ page }) => {
  const url = process.env.E2E_LIVE_KICK;
  test.skip(!url, "Set E2E_LIVE_KICK to a live Kick channel.");
  test.setTimeout(900_000);
  await startCapture(page, url!);
  await expect(page.getByLabel("Start from")).toHaveCount(0); // Kick keeps only ~30 s of history
  await page.getByLabel("Keep recording for").selectOption({ label: "1 min" });
  await page.getByRole("button", { name: "Start recording" }).click();
  const api = await waitReady(page);
  await expect(page.getByText(/Recording live: /)).toBeVisible({ timeout: 90_000 });
  await page.waitForTimeout(20_000);
  await page.getByRole("button", { name: "Stop recording now" }).click();
  // About 20 s recorded plus the ~30 s the live playlist still had.
  await finish(page, api, [15, 85]);
});
