import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./auth";

/** Length and picture of a downloaded export (ffprobe from npm). */
function probeBytes(bytes: Buffer) {
  const dir = mkdtempSync(path.join(tmpdir(), "bamio-live-export-"));
  const file = path.join(dir, "clip.mp4");
  try {
    writeFileSync(file, bytes);
    const bin = path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    const res = spawnSync(bin, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8", windowsHide: true });
    const data = JSON.parse(res.stdout || "{}") as { streams?: { codec_type: string }[]; format?: { duration: string } };
    return { hasVideo: Boolean(data.streams?.some((x) => x.codec_type === "video")), duration: Number(data.format?.duration ?? 0) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/*
 * Capturing from live streams, end to end. Opt-in, because it needs channels that are
 * live right now:
 *   E2E_LIVE_TWITCH=https://www.twitch.tv/<live channel>
 *   E2E_LIVE_YOUTUBE=https://www.youtube.com/watch?v=<live video>
 *   E2E_LIVE_KICK=https://kick.com/<live channel>
 *   npx playwright test live-stream
 */

async function startCapture(page: Page, url: string, mode: "part" | "follow" = "part") {
  await signIn(page);
  await page.goto("/new");
  await page.getByLabel("Video link").fill(url);
  await expect(page.getByText("Live now")).toBeVisible({ timeout: 90_000 });
  if (mode === "part") await page.getByRole("button", { name: "Capture a part" }).click();
}

/** Skips a capture that needs to start in the past when the stream keeps no history (a Twitch channel without past broadcasts, YouTube without rewind). */
async function needHistory(page: Page) {
  await expect(page.getByLabel("Keep recording for")).toBeVisible();
  test.skip((await page.getByLabel("Start from").count()) === 0, "This stream keeps no history to start from: use a channel that saves past broadcasts (or a YouTube stream with rewind).");
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
  await needHistory(page);
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
  await needHistory(page);
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

/*
 * Following: the whole stream (as far back as it keeps; the test server can shorten that
 * with BAMIO_FOLLOW_MAX_BACK_SEC), editable while it grows, then one MP4 when stopped.
 */
type FollowState = {
  source: { durationSec: number; live?: { follow?: { status: string; backSec: number; fromStart: boolean } } };
  job: { status: string };
  transcribedSec?: number;
  clips: { id: string; start: number; end: number }[];
};

async function follow(page: Page, url: string, opts: { captions: boolean }) {
  await startCapture(page, url, "follow");
  await expect(page.getByRole("button", { name: "Capture a part" })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "Start following" }).click();
  const api = await waitReady(page);
  const state = async () => (await (await page.request.get(api)).json()) as FollowState;

  // Editable while it grows: the video plays in the page (HLS) and the capture keeps growing.
  await expect(page.getByRole("status", { name: "Following the stream" })).toBeVisible({ timeout: 300_000 });
  await expect.poll(() => page.locator("video").first().evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 60_000 }).toBeGreaterThan(1);
  const first = (await state()).source.durationSec;
  await expect.poll(async () => (await state()).source.durationSec, { timeout: 90_000 }).toBeGreaterThan(first + 10);
  if (opts.captions) await expect.poll(async () => (await state()).transcribedSec ?? 0, { timeout: 240_000 }).toBeGreaterThan(30);
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "qa/screens/29-following-top.png" });

  // A clip from what's in so far, exported while the stream goes on. Past the first few 6 s
  // segments: exports seek into the stream's playlist, and (in fMP4 HLS) that once came out empty.
  await expect.poll(async () => (await state()).source.durationSec, { timeout: 180_000 }).toBeGreaterThan(50);
  await page.getByLabel("Start").fill("0:30");
  await page.getByLabel("End").fill("0:45");
  await page.getByRole("button", { name: "Add clip" }).click();
  const card = page.getByTestId("clip-card").filter({ hasText: "Clip at 0:30" });
  await card.getByRole("button", { name: "Export" }).click();
  const download = card.getByRole("link", { name: /^Download/ });
  await expect(download).toBeVisible({ timeout: 180_000 });
  const exported = probeBytes(Buffer.from(await (await page.request.get((await download.getAttribute("href"))!)).body()));
  expect(exported.hasVideo).toBe(true);
  expect(exported.duration).toBeGreaterThan(14);
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "qa/screens/30-following.png" });

  // The clip editor plays the growing video too.
  await card.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(/\/clips\/[0-9a-f-]{36}$/);
  await expect.poll(() => page.locator("video").first().evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 60_000 }).toBeGreaterThan(1);
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => page.locator("video").first().evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(6);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  if (process.env.E2E_SCREENSHOTS) await page.screenshot({ path: "qa/screens/31-following-editor.png" });
  await page.goBack();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);

  // Stop: the last captions, then one MP4 in place of the growing HLS.
  await page.getByRole("button", { name: "Stop following" }).click();
  await expect.poll(async () => (await state()).source.live?.follow?.status, { timeout: 600_000 }).toBe("ended");
  const done = await state();
  expect(done.job.status).toBe("ready");
  expect(done.clips.some((c) => c.start === 30)).toBe(true);
  const source = await page.request.get(`${api}/source`, { headers: { Range: "bytes=0-99" } });
  expect(source.status()).toBe(206);
  await expect.poll(() => page.locator("video").first().evaluate((v: HTMLVideoElement) => v.currentSrc), { timeout: 30_000 }).toContain("/source");
  expect((await page.request.delete(api)).status()).toBe(204);
  return done;
}

test("Twitch: follow the stream from its VOD, edit while it grows, stop", async ({ page }) => {
  const url = process.env.E2E_LIVE_TWITCH;
  test.skip(!url, "Set E2E_LIVE_TWITCH to a live Twitch channel.");
  test.setTimeout(1_800_000);
  const done = await follow(page, url!, { captions: true });
  expect(done.source.live?.follow?.backSec).toBeGreaterThan(0);
});

test("YouTube: follow the stream from its rewind history, stop", async ({ page }) => {
  const url = process.env.E2E_LIVE_YOUTUBE;
  test.skip(!url, "Set E2E_LIVE_YOUTUBE to a live YouTube stream.");
  test.setTimeout(1_800_000);
  await follow(page, url!, { captions: false });
});

test("Kick: follow the stream from now, stop", async ({ page }) => {
  const url = process.env.E2E_LIVE_KICK;
  test.skip(!url, "Set E2E_LIVE_KICK to a live Kick channel.");
  test.setTimeout(1_800_000);
  await follow(page, url!, { captions: false });
});
