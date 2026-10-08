import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_VIDEO, signIn } from "./auth";
import { canDecodeSample, now } from "./editor-helpers";

/*
 * The editor (/editor), which runs in the browser: add a video, cut it, add text, change the
 * frame, export on the device and check the file, then find the edit again after a reload.
 * Nothing here touches the server after the page has loaded. The video is H.264: a browser
 * without that codec (the open-source Chromium on CI) can't open it, and the editing part is
 * skipped there. E2E_SCREENSHOTS=1 also saves screenshots to qa/screens/.
 */

const shots = Boolean(process.env.E2E_SCREENSHOTS);
const shot = async (page: Page, name: string) => {
  if (!shots) return;
  mkdirSync("qa/screens", { recursive: true });
  await page.screenshot({ path: `qa/screens/${name}.png` });
};

function probe(file: string) {
  const bin = path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  const res = spawnSync(bin, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8", windowsHide: true });
  const data = JSON.parse(res.stdout) as { streams: { codec_type: string; codec_name?: string; width?: number; height?: number }[]; format: { duration: string } };
  const video = data.streams.find((s) => s.codec_type === "video");
  return { codec: video?.codec_name, width: video?.width, height: video?.height, hasAudio: data.streams.some((s) => s.codec_type === "audio"), duration: Number(data.format.duration) };
}

/** How bright the middle of the preview is: 0 when nothing is drawn there. */
const lit = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>("canvas[role=img]");
    const pixel = canvas?.getContext("2d")?.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    return pixel ? pixel[0]! + pixel[1]! + pixel[2]! : 0;
  });

test("the editor needs a sign-in, like the rest of the app", async ({ page }) => {
  await page.goto("/editor");
  await expect(page).toHaveURL(/\/sign-in/);
});

test.describe("the editor", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("opens for an account without a plan, and says where edits are kept", async ({ page }) => {
    await page.goto("/editor");
    await expect(page.getByRole("heading", { name: "Editor", level: 1 })).toBeVisible();
    await expect(page.getByText("Your files stay on this device. Nothing is uploaded, and the export is made here too.")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Editor" })).toHaveAttribute("aria-current", "page");
    // An empty edit opens too, and offers to add files.
    await page.getByRole("button", { name: "Start empty" }).click();
    await expect(page).toHaveURL(/\/editor\?edit=/);
    await expect(page.getByText("Add a video or a photo to start.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Play" })).toBeDisabled();
    await shot(page, "30-editor-empty");
    await page.getByRole("button", { name: "Edits" }).click();
    await expect(page.getByRole("heading", { name: "Your edits on this device" })).toBeVisible();
    await page.getByRole("button", { name: "Delete Untitled edit" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete edit" }).click();
  });

  test("cuts, captions and exports a video on the device, and keeps the edit", async ({ page }) => {
    test.setTimeout(6 * 60_000);
    await page.goto("/editor");
    test.skip(!(await canDecodeSample(page)), "This browser can't decode H.264 with WebCodecs.");
    // What the page asks of the server from here on: nothing but its own pages and scripts.
    const uploads: string[] = [];
    page.on("request", (r) => {
      if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/")) uploads.push(`${r.method()} ${r.url()}`);
    });

    await page.getByTestId("editor-new-files").setInputFiles(SAMPLE_VIDEO);
    await expect(page).toHaveURL(/\/editor\?edit=/);
    const clips = page.getByRole("listbox", { name: "Clips" }).getByRole("option");
    await expect(clips).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByLabel("Name of this edit")).toHaveValue("sample-talk");
    await expect(page.getByLabel("Preview").getByText("/ 0:40.0")).toBeVisible();

    // It plays: the clock moves.
    await page.getByRole("button", { name: "Play" }).click();
    await expect.poll(() => now(page), { timeout: 20_000 }).toBeGreaterThan(0.5);
    await page.getByRole("button", { name: "Pause" }).click();
    // And the picture is there, paused too.
    await expect.poll(() => lit(page)).toBeGreaterThan(0);

    // Split at 10 s and at 30 s (arrow keys move a second at a time with Shift), and delete the middle.
    await page.getByRole("group", { name: "Tracks" }).focus();
    await page.keyboard.press("Home");
    await expect.poll(() => now(page)).toBe(0);
    const goTo = async (seconds: number) => {
      const steps = Math.round(seconds - (await now(page)));
      for (let i = 0; i < Math.abs(steps); i++) await page.keyboard.press(steps > 0 ? "Shift+ArrowRight" : "Shift+ArrowLeft");
      await expect.poll(() => now(page)).toBe(seconds);
    };
    await goTo(10);
    await page.getByRole("button", { name: "Split", exact: true }).click();
    await expect(clips).toHaveCount(2);
    await goTo(30);
    await page.keyboard.press("s");
    await expect(clips).toHaveCount(3);
    await clips.nth(1).click();
    await expect(clips.nth(1)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Delete");
    await expect(clips).toHaveCount(2);
    await expect(page.getByLabel("Preview").getByText("/ 0:20.0")).toBeVisible();
    // Undo brings it back, redo takes it away again.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(clips).toHaveCount(3);
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(clips).toHaveCount(2);

    // The selected clip's settings: twice the speed makes it half as long.
    await clips.first().click();
    await expect(page.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("group", { name: "Speed" }).getByRole("button", { name: "2x" }).click();
    await expect(page.getByLabel("Preview").getByText("/ 0:15.0")).toBeVisible();
    await page.getByRole("group", { name: "Look" }).getByRole("button", { name: "Vivid" }).click();

    // Text at the playhead (put at 1 s), typed over.
    await page.getByRole("group", { name: "Tracks" }).focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowRight");
    await page.getByRole("tab", { name: "Text" }).click();
    await page.getByRole("button", { name: "Add text" }).click();
    await page.getByRole("textbox", { name: "Text" }).fill("Made in the browser");
    await expect(page.getByRole("listbox", { name: "Text" }).getByRole("option", { name: "Text: Made in the browser" })).toBeVisible();

    // The tools: silences are found once the sound has been measured, and the bar is switched on.
    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByRole("status").filter({ hasText: /pause|No pauses/ })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("switch", { name: "A bar that fills as the video plays" }).check();

    // A square frame.
    await page.getByRole("tab", { name: "Frame" }).click();
    await page.getByRole("group", { name: "Shape" }).getByRole("button", { name: /1:1/ }).click();
    await expect(page.getByText("Saved on this device")).toBeVisible({ timeout: 15_000 });
    // The preview is drawn again in its new shape (it once stayed black after the first pause).
    await expect.poll(() => lit(page)).toBeGreaterThan(0);
    await shot(page, "31-editor");

    // Export at 720p, here in the browser.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await dialog.getByRole("button", { name: "720p (faster)" }).click();
    await expect(dialog.getByText("0:15 long, 720 x 720")).toBeVisible();
    await shot(page, "32-editor-export");
    await dialog.getByRole("button", { name: "Export the video" }).click();
    const ready = page.getByRole("dialog", { name: "Your video is ready" });
    await expect(ready).toBeVisible({ timeout: 4 * 60_000 });
    const download = page.waitForEvent("download");
    await ready.getByRole("link", { name: "Download" }).click();
    const file = await (await download).path();
    if (shots) copyFileSync(file, "qa/screens/editor-export.mp4");
    const info = probe(file);
    expect(info).toMatchObject({ width: 720, height: 720, hasAudio: true });
    expect(["h264", "vp9", "vp8"]).toContain(info.codec);
    expect(info.duration).toBeGreaterThan(14.5);
    expect(info.duration).toBeLessThan(15.6);
    await shot(page, "33-editor-exported");
    await ready.getByRole("button", { name: "Back to the edit" }).click();
    expect(uploads).toEqual([]);

    // The edit is kept in the browser: a reload comes back to it, files and all.
    await page.reload();
    await expect(clips).toHaveCount(2, { timeout: 60_000 });
    await expect(page.getByRole("listbox", { name: "Text" }).getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Play" })).toBeEnabled();
    await page.getByRole("button", { name: "Edits" }).click();
    const saved = page.getByRole("listitem").filter({ hasText: "sample-talk" });
    await expect(saved.getByText("0:15, 2 clips")).toBeVisible();
    await saved.getByRole("button", { name: "Delete sample-talk" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete edit" }).click();
    await expect(saved).toHaveCount(0);
  });

  test("combines videos, a photo and music in a vertical frame, cuts the silences, and exports 1080p", async ({ page }) => {
    test.setTimeout(10 * 60_000);
    await page.goto("/editor");
    test.skip(!(await canDecodeSample(page)), "This browser can't decode H.264 with WebCodecs.");
    const footage = (name: string) => path.join(process.cwd(), "public", "landing", name);
    // A tone to stand in for music.
    const tone = path.join(process.cwd(), "qa", "fixtures", "tone.wav");
    if (!existsSync(tone)) {
      const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
      spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=12", "-ac", "2", tone], { windowsHide: true });
    }
    /** The edit's length, from the clock under the preview. */
    const total = async () => {
      const [m, s] = (((await page.getByLabel("Preview").locator("p").first().textContent()) ?? "").split("/")[1] ?? "0:0").trim().split(":");
      return Number(m) * 60 + Number(s);
    };

    await page.getByTestId("editor-new-files").setInputFiles([SAMPLE_VIDEO, footage("podcast.mp4"), footage("podcast-0.webp")]);
    const clips = page.getByRole("listbox", { name: "Clips" }).getByRole("option");
    await expect(clips).toHaveCount(3, { timeout: 90_000 });
    await expect(clips.nth(2)).toHaveAccessibleName(/podcast-0\.webp, 0:04\.0/);
    const whole = await total();

    // Music from the device, on its own track.
    await page.getByRole("tab", { name: "Sound" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add music or a sound" }).click();
    await (await chooser).setFiles(tone);
    const sounds = page.getByRole("listbox", { name: "Sounds" }).getByRole("option");
    await expect(sounds).toHaveCount(1, { timeout: 60_000 });
    await sounds.first().click();
    await expect(page.getByRole("tab", { name: "Edit" })).toHaveAttribute("aria-selected", "true");
    await page.getByLabel("Fade out").fill("2");

    // Drag the photo to the front: it changes places with the clips it passes.
    const photo = await clips.nth(2).boundingBox();
    const first = await clips.nth(0).boundingBox();
    await page.mouse.move(photo!.x + photo!.width / 2, photo!.y + photo!.height / 2);
    await page.mouse.down();
    await page.mouse.move(first!.x + 30, first!.y + first!.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(clips.nth(0)).toHaveAccessibleName(/podcast-0\.webp/);
    await expect(clips.nth(0)).toHaveAttribute("aria-selected", "true");
    // Pull its right edge in: a shorter photo, and everything after it moves up.
    const still = await clips.nth(0).boundingBox();
    await page.mouse.move(still!.x + still!.width - 4, still!.y + still!.height / 2);
    await page.mouse.down();
    await page.mouse.move(still!.x + still!.width / 2, still!.y + still!.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(total).toBeLessThan(whole - 1);
    await expect.poll(total).toBeGreaterThan(whole - 3);

    // The wide podcast shot whole, over a blurred copy of itself.
    const podcast = clips.filter({ hasText: "podcast.mp4" });
    await podcast.click();
    await page.getByRole("group", { name: "Framing" }).getByRole("button", { name: "Fit all of it" }).click();
    await page.getByRole("group", { name: "Motion" }).getByRole("button", { name: "Push in" }).click();
    await page.getByLabel("Fade in").fill("0.5");

    // Silences in the talk are found and cut in one go.
    await page.getByRole("tab", { name: "Tools" }).click();
    const found = page.getByRole("status").filter({ hasText: /pauses?,/ });
    await expect(found).toBeVisible({ timeout: 90_000 });
    const before = await total();
    const count = await clips.count();
    await page.getByRole("button", { name: "Cut them out" }).click();
    await expect(page.getByText(/pauses? cut out/)).toBeVisible();
    expect(await clips.count()).toBeGreaterThan(count);
    expect(await total()).toBeLessThan(before - 0.5);
    // One undo brings every pause back.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(total).toBe(before);
    await page.getByRole("button", { name: "Redo" }).click();

    // A title, a caption and a sticker, each in its own style.
    await page.getByRole("group", { name: "Tracks" }).focus();
    await page.keyboard.press("Home");
    await page.getByRole("tab", { name: "Text" }).click();
    await page.getByRole("button", { name: "Title", exact: true }).click();
    await page.getByRole("textbox", { name: "Text" }).fill("Three clips, one edit");
    await page.getByRole("tab", { name: "Text" }).click();
    await page.getByRole("button", { name: "Caption", exact: true }).click();
    await page.getByRole("tab", { name: "Text" }).click();
    await page.getByRole("button", { name: "Add 🔥" }).click();
    await expect(page.getByRole("listbox", { name: "Text" }).getByRole("option")).toHaveCount(3);
    await expect.poll(() => lit(page)).toBeGreaterThan(0);
    await shot(page, "34-editor-vertical");

    // 1080 x 1920, with the talk and the music mixed.
    const length = await total();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Export" });
    await expect(dialog.getByText("1080 x 1920")).toBeVisible();
    await dialog.getByRole("button", { name: "Export the video" }).click();
    const ready = page.getByRole("dialog", { name: "Your video is ready" });
    await expect(ready).toBeVisible({ timeout: 8 * 60_000 });
    const download = page.waitForEvent("download");
    await ready.getByRole("link", { name: "Download" }).click();
    const file = await (await download).path();
    if (shots) copyFileSync(file, "qa/screens/editor-vertical.mp4");
    const info = probe(file);
    expect(info).toMatchObject({ width: 1080, height: 1920, hasAudio: true });
    expect(Math.abs(info.duration - length)).toBeLessThan(0.2);
    await ready.getByRole("button", { name: "Back to the edit" }).click();

    await page.getByRole("button", { name: "Edits" }).click();
    const saved = page.getByRole("listitem").filter({ hasText: "sample-talk" });
    await saved.getByRole("button", { name: "Delete sample-talk" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete edit" }).click();
    await expect(saved).toHaveCount(0);
  });
});

/*
 * The picture of the editor on its public page (/video-editor): the editor itself with stock
 * footage in it, saved as public/landing/editor.webp.
 *   E2E_EDITOR_SHOT=1 npx playwright test editor -g "picture"
 */
test("takes the picture of the editor for its public page", async ({ page }) => {
  test.skip(!process.env.E2E_EDITOR_SHOT, "Set E2E_EDITOR_SHOT=1 to make public/landing/editor.webp again.");
  test.setTimeout(4 * 60_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);
  await page.goto("/editor");
  const footage = (name: string) => path.join(process.cwd(), "public", "landing", name);
  await page.getByTestId("editor-new-files").setInputFiles([footage("reel-clutch.mp4"), footage("podcast.mp4"), footage("reel-racer.mp4")]);
  const clips = page.getByRole("listbox", { name: "Clips" }).getByRole("option");
  await expect(clips).toHaveCount(3, { timeout: 90_000 });
  await page.getByLabel("Name of this edit").fill("Friday stream, best bits");
  await clips.nth(1).click();
  await page.getByRole("group", { name: "Framing" }).getByRole("button", { name: "Fit all of it" }).click();
  await page.getByRole("tab", { name: "Sound" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add music or a sound" }).click();
  // Something with the shape of music: a low note that pulses and swells.
  const music = path.join(process.cwd(), "qa", "fixtures", "music.wav");
  const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "aevalsrc=0.7*sin(2*PI*110*t)*abs(sin(2*PI*1.9*t))*(0.35+0.65*abs(sin(2*PI*0.21*t))):d=22:s=44100", music], { windowsHide: true });
  await (await chooser).setFiles(music);
  await expect(page.getByRole("listbox", { name: "Sounds" }).getByRole("option")).toHaveCount(1, { timeout: 60_000 });
  await page.getByRole("group", { name: "Tracks" }).focus();
  await page.keyboard.press("Home");
  await page.getByRole("tab", { name: "Text" }).click();
  await page.getByRole("button", { name: "Title", exact: true }).click();
  await page.getByRole("textbox", { name: "Text" }).fill("1v4 and we won");
  await page.getByLabel("Shows for").fill("6");
  await page.getByRole("tab", { name: "Text" }).click();
  await page.getByRole("button", { name: "Caption", exact: true }).click();
  await page.getByRole("textbox", { name: "Text" }).fill("no way that worked");
  await page.getByLabel("Shows for").fill("5");
  // Two seconds in, where both lines of text are up; the settings from their top.
  await page.getByRole("group", { name: "Tracks" }).focus();
  for (let i = 0; i < 2; i++) await page.keyboard.press("Shift+ArrowRight");
  await page.getByRole("tabpanel").evaluate((el) => el.scrollTo(0, 0));
  // No focus ring in the picture.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // Thumbnails and the waveform have come in.
  await page.waitForTimeout(6000);
  const png = path.join("qa", "screens", "editor-for-landing.png");
  mkdirSync(path.dirname(png), { recursive: true });
  await page.locator("main").screenshot({ path: png });
  spawnSync(ffmpeg, ["-v", "error", "-y", "-i", png, "-c:v", "libwebp", "-quality", "88", path.join("public", "landing", "editor.webp")], { windowsHide: true });
});
