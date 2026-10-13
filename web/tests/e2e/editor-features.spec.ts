import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_VIDEO, signIn } from "./auth";
import { canDecodeSample, now } from "./editor-helpers";

/*
 * The editor's fuller features, with plans off (so everything is open): a transition, a freeze
 * frame, a reversed clip, a typeface and an outline, a logo as a layer, a facecam layout, green
 * screen, loudness levelling, auto captions (the sound goes to the server's transcriber, for
 * real) and an export in two shapes, checked with ffprobe. Needs H.264 in WebCodecs, like the
 * other editing tests. The only thing the page may send is the sound for captions.
 */

const bin = (name: "ffmpeg" | "ffprobe") =>
  name === "ffmpeg"
    ? path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg")
    : path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");

function probe(file: string) {
  const res = spawnSync(bin("ffprobe"), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8", windowsHide: true });
  const data = JSON.parse(res.stdout) as { streams: { codec_type: string; codec_name?: string; width?: number; height?: number }[]; format: { duration: string } };
  const video = data.streams.find((s) => s.codec_type === "video");
  return { codec: video?.codec_name, width: video?.width, height: video?.height, hasAudio: data.streams.some((s) => s.codec_type === "audio"), duration: Number(data.format.duration) };
}

/** A small logo: a picture with a volt square on it. */
function logo(): string {
  const file = path.join(process.cwd(), "qa", "fixtures", "logo.png");
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    spawnSync(bin("ffmpeg"), ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0xC8FF3D:s=240x120", "-frames:v", "1", file], { windowsHide: true });
  }
  return file;
}

const goTo = async (page: Page, seconds: number) => {
  await page.getByRole("group", { name: "Tracks" }).focus();
  await page.keyboard.press("Home");
  for (let i = 0; i < seconds; i++) await page.keyboard.press("Shift+ArrowRight");
  await expect.poll(() => now(page)).toBe(seconds);
};

test("transitions, freeze, reverse, layers, layouts, captions and two shapes in one export", async ({ page }) => {
  test.setTimeout(12 * 60_000);
  await signIn(page);
  await page.goto("/editor");
  test.skip(!(await canDecodeSample(page)), "This browser can't decode H.264 with WebCodecs.");
  // A failure in the browser is easier to read with its own message.
  page.on("console", (m) => {
    if (m.type() === "error") console.log(`browser: ${m.text().slice(0, 400)}`);
  });
  const sent: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && new URL(r.url()).pathname.startsWith("/api/")) sent.push(new URL(r.url()).pathname);
  });

  await page.getByTestId("editor-new-files").setInputFiles(SAMPLE_VIDEO);
  const clips = page.getByRole("listbox", { name: "Clips" }).getByRole("option");
  await expect(clips).toHaveCount(1, { timeout: 60_000 });

  // Split at 10 s, and slide into the second clip.
  await goTo(page, 10);
  await page.getByRole("button", { name: "Split", exact: true }).click();
  await expect(clips).toHaveCount(2);
  await clips.nth(1).click();
  const transition = page.getByRole("group", { name: "Transition in" });
  await transition.getByRole("button", { name: "Slide" }).click();
  await expect(transition.getByRole("button", { name: "Slide" })).toHaveAttribute("aria-pressed", "true");

  // The first clip has no transition in; a freeze frame at 4 s splits it around a still.
  await goTo(page, 4);
  await clips.first().click();
  await expect(page.getByRole("group", { name: "Transition in" })).toHaveCount(0);
  await page.getByRole("button", { name: "Freeze frame" }).click();
  await expect(clips).toHaveCount(4);
  await expect(page.getByLabel("Preview").getByText("/ 0:42.0")).toBeVisible();

  // The last clip (10 s to 40 s) reversed: a new file in the edit, made here.
  await clips.last().click();
  await page.getByRole("button", { name: "Reverse" }).click();
  await expect(page.getByText("Reversed", { exact: true })).toBeVisible({ timeout: 4 * 60_000 });
  await page.getByRole("tab", { name: "Media" }).click();
  await expect(page.getByRole("tabpanel", { name: "Media" }).getByText("sample-talk reversed.mp4")).toBeVisible();

  // A logo as a layer, put in the bottom left.
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add videos, photos or sounds" }).click();
  await (await chooser).setFiles(logo());
  await page.getByRole("button", { name: "Add logo.png as a layer" }).click();
  const layers = page.getByRole("listbox", { name: "Layers" }).getByRole("option");
  await expect(layers).toHaveCount(1);
  await page.getByRole("group", { name: "Place" }).getByRole("button", { name: "Bottom left" }).click();
  await expect(page.getByRole("group", { name: "Place" }).getByRole("button", { name: "Bottom left" })).toHaveAttribute("aria-pressed", "true");
  // The photo also went on the main track when it was added: take it off again.
  const photoClip = page.getByRole("listbox", { name: "Clips" }).getByRole("option", { name: /logo/ });
  if ((await photoClip.count()) > 0) {
    await photoClip.first().click();
    await page.keyboard.press("Delete");
  }
  await expect(clips).toHaveCount(4);

  // Auto-reframe loads the face finder (served by Bamio) and looks: the sample is a test pattern, with no face in it.
  await clips.first().click();
  await page.getByRole("button", { name: "Follow the face" }).click();
  await expect(page.getByText("No face found")).toBeVisible({ timeout: 2 * 60_000 });

  // A facecam on the first clip, with the camera in the top right of the video; green screen too.
  await page.getByRole("group", { name: "Layout" }).getByRole("button", { name: "Facecam on top" }).click();
  const corners = page.getByRole("group", { name: "Where the camera is in the video" });
  await corners.getByRole("button", { name: "Top right" }).click();
  await expect(corners.getByRole("button", { name: "Top right" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("switch", { name: "Take out the green behind" }).check();
  await expect(page.getByRole("slider", { name: "How close counts" })).toBeVisible();

  // Text in Anton, with an outline.
  await page.getByRole("tab", { name: "Text" }).click();
  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByRole("textbox", { name: "Text", exact: true }).fill("Wait for it");
  await page.getByRole("group", { name: "Typeface" }).getByRole("button", { name: "Anton" }).click();
  await expect(page.getByRole("group", { name: "Typeface" }).getByRole("button", { name: "Anton" })).toHaveAttribute("aria-pressed", "true");

  // Captions for the whole edit: only the sound is sent, and the words come back.
  await page.getByRole("tab", { name: "Text" }).click();
  await page.getByLabel("Spoken language").selectOption("en");
  await page.getByRole("button", { name: "Make captions" }).click();
  await expect(page.getByText("Captions made")).toBeVisible({ timeout: 6 * 60_000 });
  await expect(page.getByText(/Fix the words \(\d+ lines\)/)).toBeVisible();
  await page.getByRole("group", { name: "Caption style" }).getByRole("button", { name: "Karaoke" }).click();
  // A line typed over.
  await page.getByText(/Fix the words/).click();
  const firstLine = page.getByRole("textbox", { name: /^Caption at / }).first();
  await firstLine.fill("Hello there");
  await firstLine.press("Enter");
  await expect(page.getByRole("textbox", { name: /^Caption at / }).first()).toHaveValue("Hello there");

  // Loudness levelling.
  await page.getByRole("tab", { name: "Tools" }).click();
  await page.getByRole("switch", { name: "Even out the loudness" }).check();

  // Two shapes in one export (1080p: with plans off, everything is open).
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export" });
  await dialog.getByRole("group", { name: "Also export as" }).getByRole("button", { name: /^1:1/ }).click();
  await dialog.getByRole("button", { name: "Export 2 videos" }).click();
  const ready = page.getByRole("dialog", { name: "Your videos are ready" });
  await expect(ready).toBeVisible({ timeout: 6 * 60_000 });
  const files: string[] = [];
  for (const name of ["Download 9:16", "Download 1:1"]) {
    const download = page.waitForEvent("download");
    await ready.getByRole("link", { name }).click();
    files.push(await (await download).path());
  }
  // E2E_SCREENSHOTS=1 keeps the files, to look at.
  if (process.env.E2E_SCREENSHOTS) {
    mkdirSync("qa/screens", { recursive: true });
    files.forEach((f, i) => copyFileSync(f, `qa/screens/editor-features-${i}.mp4`));
  }
  const [tall, square] = files.map(probe);
  expect(tall).toMatchObject({ codec: "h264", width: 1080, height: 1920, hasAudio: true });
  expect(square).toMatchObject({ codec: "h264", width: 1080, height: 1080, hasAudio: true });
  expect(Math.abs(tall!.duration - 42)).toBeLessThan(0.5);

  // Nothing but the sound for captions was sent.
  expect(sent.filter((p) => p !== "/api/editor/captions")).toEqual([]);
  expect(sent).toContain("/api/editor/captions");
});
