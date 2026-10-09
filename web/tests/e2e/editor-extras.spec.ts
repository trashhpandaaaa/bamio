import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_VIDEO, signIn } from "./auth";
import { canDecodeSample, now } from "./editor-helpers";

/*
 * The editor's extras, with plans off (so everything is open): the safe zones over a vertical
 * video, an export at 60 frames a second, and music that ducks under speech, heard in the file
 * that comes out. Needs H.264 in WebCodecs, like the other editing tests.
 */

const bin = (name: "ffmpeg" | "ffprobe") =>
  name === "ffmpeg"
    ? path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
    : path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

/** Frames a second and the size of a video file. */
function probe(file: string) {
  const res = spawnSync(bin("ffprobe"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate,width,height,nb_frames", "-of", "json", file], { encoding: "utf8", windowsHide: true });
  const stream = (JSON.parse(res.stdout) as { streams: { r_frame_rate: string; width: number; height: number }[] }).streams[0]!;
  const [n, d] = stream.r_frame_rate.split("/").map(Number);
  return { fps: n! / (d || 1), width: stream.width, height: stream.height };
}

/** How loud a file's sound is on the whole, in dB (ffmpeg's volumedetect). */
function meanVolume(file: string): number {
  const res = spawnSync(bin("ffmpeg"), ["-hide_banner", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8", windowsHide: true });
  const found = /mean_volume:\s*(-?[\d.]+) dB/.exec(res.stderr);
  if (!found) throw new Error(`no volume in ${file}: ${res.stderr.slice(-300)}`);
  return Number(found[1]);
}

async function exportFile(page: Page, choose: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>): Promise<string> {
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await choose(dialog);
  await dialog.getByRole("button", { name: "Export the video" }).click();
  const ready = page.getByRole("dialog", { name: "Your video is ready" });
  await expect(ready).toBeVisible({ timeout: 4 * 60_000 });
  const download = page.waitForEvent("download");
  await ready.getByRole("link", { name: "Download" }).click();
  const file = await (await download).path();
  await ready.getByRole("button", { name: "Back to the edit" }).click();
  return file;
}

test("safe zones, 60 frames a second, and music that makes way for speech", async ({ page }) => {
  test.setTimeout(8 * 60_000);
  await signIn(page);
  await page.goto("/editor");
  test.skip(!(await canDecodeSample(page)), "This browser can't decode H.264 with WebCodecs.");
  const tone = path.join(process.cwd(), "qa", "fixtures", "tone.wav");
  if (!existsSync(tone)) {
    mkdirSync(path.dirname(tone), { recursive: true });
    spawnSync(bin("ffmpeg"), ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=12", "-ac", "2", tone], { windowsHide: true });
  }

  await page.getByTestId("editor-new-files").setInputFiles(SAMPLE_VIDEO);
  const clips = page.getByRole("listbox", { name: "Clips" }).getByRole("option");
  await expect(clips).toHaveCount(1, { timeout: 60_000 });

  // The edges the apps cover, shaded over a vertical video; not on a square one.
  const zones = page.getByRole("button", { name: "Safe zones" });
  await expect(page.getByTestId("safe-zones")).toHaveCount(0);
  await zones.click();
  await expect(zones).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("safe-zones")).toBeVisible();
  if (process.env.E2E_SCREENSHOTS) {
    mkdirSync("qa/screens", { recursive: true });
    await page.screenshot({ path: "qa/screens/37-editor-safe-zones.png" });
  }
  await page.getByRole("tab", { name: "Frame" }).click();
  await page.getByRole("group", { name: "Shape" }).getByRole("button", { name: /1:1/ }).click();
  await expect(page.getByTestId("safe-zones")).toHaveCount(0);
  await expect(zones).toBeDisabled();
  await page.getByRole("group", { name: "Shape" }).getByRole("button", { name: /9:16/ }).click();
  await expect(page.getByTestId("safe-zones")).toBeVisible();
  await zones.click();
  await expect(page.getByTestId("safe-zones")).toHaveCount(0);

  // Ten seconds of the talk, turned right down so the music is what's heard, with music from the start.
  const tracks = page.getByRole("group", { name: "Tracks" });
  await tracks.focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < 10; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => now(page)).toBe(10);
  await page.keyboard.press("s");
  await expect(clips).toHaveCount(2);
  await clips.nth(1).click();
  await page.keyboard.press("Delete");
  await expect(clips).toHaveCount(1);
  await clips.first().click();
  await page.getByLabel("Volume").fill("0.06");
  await tracks.focus();
  await page.keyboard.press("Home");
  await page.getByRole("tab", { name: "Sound" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add music or a sound" }).click();
  await (await chooser).setFiles(tone);
  const sounds = page.getByRole("listbox", { name: "Sounds" }).getByRole("option");
  await expect(sounds).toHaveCount(1, { timeout: 60_000 });
  await sounds.first().click();

  // As it is: the music at one level all the way, 30 frames a second.
  const plain = await exportFile(page, async (dialog) => {
    await dialog.getByRole("button", { name: "720p (faster)" }).click();
    await expect(dialog.getByText("720 x 1280, 30 frames a second")).toBeVisible();
  });
  expect(probe(plain)).toMatchObject({ fps: 30, width: 720, height: 1280 });

  // Ducking, at 60 frames a second: twice the frames, and quieter on the whole, since the music drops under the talking.
  await sounds.first().click();
  const duck = page.getByRole("switch", { name: "Lower it while someone talks" });
  await duck.check();
  await expect(duck).toBeChecked();
  const ducked = await exportFile(page, async (dialog) => {
    await dialog.getByRole("button", { name: "720p (faster)" }).click();
    await dialog.getByRole("button", { name: "60 a second" }).click();
    await expect(dialog.getByText("720 x 1280, 60 frames a second")).toBeVisible();
  });
  expect(probe(ducked)).toMatchObject({ fps: 60, width: 720, height: 1280 });
  const before = meanVolume(plain);
  const after = meanVolume(ducked);
  console.log(`[editor-extras] mean volume ${before} dB as it is, ${after} dB ducking`);
  expect(after).toBeLessThan(before - 2);

  // The switch is undone like anything else.
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(duck).not.toBeChecked();

  await page.getByRole("button", { name: "Edits" }).click();
  const saved = page.getByRole("listitem").filter({ hasText: "sample-talk" });
  await saved.getByRole("button", { name: "Delete sample-talk" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete edit" }).click();
  await expect(saved).toHaveCount(0);
});
