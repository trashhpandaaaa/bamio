import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { SAMPLE_VIDEO, signIn } from "./auth";

/*
 * The main flow against a running app in mock-AI mode (BAMIO_AI_MOCK=1):
 * upload a video, get AI clips, mark one by hand, edit, export with the real
 * ffmpeg pipeline, check the file, then clean up. Test servers preview emails (BAMIO_EMAIL=preview):
 * the "clips are ready" email is checked in the server's database.
 * E2E_SCREENSHOTS=1 also saves screenshots to qa/screens/.
 */

const sql = postgres(process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/bamio", { onnotice: () => undefined, max: 2 });
test.afterAll(() => sql.end());

const shots = Boolean(process.env.E2E_SCREENSHOTS);
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: `qa/screens/${name}.png` });
};

function probe(file: string) {
  const bin = path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
  const res = spawnSync(bin, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file], { encoding: "utf8", windowsHide: true });
  const data = JSON.parse(res.stdout) as { streams: { codec_type: string; width?: number; height?: number }[]; format: { duration: string } };
  const video = data.streams.find((s) => s.codec_type === "video");
  return { width: video?.width, height: video?.height, hasAudio: data.streams.some((s) => s.codec_type === "audio"), duration: Number(data.format.duration) };
}

test.describe("signed out", () => {
  test("APIs refuse and app pages send you to sign in", async ({ page, request }) => {
    const res = await request.get("/api/projects");
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe("signed_out");
    await page.goto("/projects");
    await expect(page).toHaveURL(/sign-in/);
  });
});

test.describe("clipping", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("link checks happen before anything is sent", async ({ page }) => {
    await page.goto("/new");
    const link = page.getByLabel("Video link");
    await link.fill("http://192.168.1.10/video.mp4");
    await expect(page.getByText("That address isn’t on the public internet.")).toBeVisible();
    await link.fill("ftp://example.com/video.mp4");
    await expect(page.getByText("Only http and https links are supported.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Import/ })).toBeDisabled();
  });

  test("upload, find clips, edit, export and clean up", async ({ page }) => {
    // Upload (two chunks) with AI clip finding on, 15 to 30 second clips.
    await page.goto("/new");
    await page.getByRole("button", { name: "Upload a file" }).click();
    await page.locator('input[type="file"]').setInputFiles(SAMPLE_VIDEO);
    await expect(page.getByText("sample-talk.mp4")).toBeVisible();
    await page.getByRole("group", { name: "Clip length" }).getByRole("button", { name: "15 to 30s" }).click();
    await page.getByRole("group", { name: "Format" }).getByRole("button", { name: "9:16 Vertical" }).click();
    await shot(page, "10-import-upload");
    await page.getByRole("button", { name: "Import and find clips" }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    const projectUrl = page.url();

    // Processing finishes and the (mock) AI suggests clips.
    const cards = page.getByTestId("clip-card");
    await expect(cards.first()).toBeVisible({ timeout: 120_000 });
    const aiCount = await cards.count();
    expect(aiCount).toBeGreaterThan(0);
    await expect(cards.first().locator(".badge.is-live")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Clips/ })).toBeVisible();
    await shot(page, "11-project-ready");

    // The "clips are ready" email was queued once, and written (previewed, never sent, on test servers).
    const system = (await (await page.request.get("/api/system/status")).json()) as { email?: boolean };
    if (system.email) {
      const key = `video-ready:${new URL(projectUrl).pathname.split("/").pop()}`;
      await expect.poll(async () => (await sql<{ status: string }[]>`select status from emails where key = ${key}`).map((r) => r.status), { timeout: 30_000 }).toEqual(["previewed"]);
      const [email] = await sql<{ subject: string }[]>`select subject from emails where key = ${key}`;
      expect(email?.subject).toMatch(/^Your clips are ready: “sample-talk/);
    }

    // Mark a clip by hand.
    await page.getByLabel("Start").fill("0:02");
    await page.getByLabel("End").fill("0:08");
    await expect(page.getByText("0:06.00 long.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Add clip" }).click();
    await expect(page.getByText("Clip added")).toBeVisible();
    await expect(cards).toHaveCount(aiCount + 1);

    // A range that is too short is explained and can't be added.
    await page.getByLabel("Start").fill("0:10");
    await page.getByLabel("End").fill("0:11");
    await expect(page.getByText("A clip needs at least 3 seconds.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add clip" })).toBeDisabled();
    await page.getByLabel("Start").fill("");
    await page.getByLabel("End").fill("");

    // Edit the best AI clip.
    await cards.first().getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(/\/clips\/[0-9a-f-]{36}$/);
    const status = page.getByRole("status").filter({ hasText: /Saved|Saving/ });
    await expect(status).toHaveText(/Saved/);

    // The speech was transcribed on the device, and captions play in the preview.
    await page.getByText(/Fix caption words/).click();
    await expect(page.locator("details input").first()).toHaveValue(/welcome back/i);
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("caption")).toBeVisible({ timeout: 15_000 });

    // While it plays, the highlighted caption word is the word spoken at that moment.
    const apiBase = new URL(projectUrl).pathname.replace("/projects/", "/api/projects/");
    const transcript = (await (await page.request.get(`${apiBase}/transcript`)).json()) as {
      segments: { text: string; words?: { start: number; end: number }[] }[];
    };
    const timed = transcript.segments.flatMap((s) => s.text.split(/\s+/).map((text, i) => ({ text, start: s.words?.[i]?.start ?? NaN })));
    expect(timed.every((w) => Number.isFinite(w.start))).toBe(true);
    let checked = 0;
    for (let n = 0; n < 40 && checked < 6; n++) {
      const seen = await page.evaluate(() => ({
        t: document.querySelector("video")?.currentTime ?? 0,
        word: document.querySelector("[data-active-word]")?.textContent ?? null,
      }));
      if (seen.word) {
        // Which words were being spoken in the moment around this frame (one frame of slack each way).
        const near = timed.filter((w, i) => w.start <= seen.t + 0.1 && (timed[i + 1]?.start ?? Infinity) > seen.t - 0.1).map((w) => w.text);
        expect(near, `at ${seen.t.toFixed(2)} s the caption showed "${seen.word}"`).toContain(seen.word);
        checked++;
      }
      await page.waitForTimeout(250);
    }
    expect(checked).toBeGreaterThanOrEqual(4);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await shot(page, "12-editor");

    await page.getByRole("group", { name: "Format" }).getByRole("button", { name: "1:1 Square" }).click();
    await page.getByRole("button", { name: /^Boxed/ }).click();
    await page.getByRole("switch", { name: "Show a title" }).check();
    await page.getByLabel("Title text").fill("E2E title");
    await expect(status).toHaveText(/Saved/, { timeout: 10_000 });
    await expect(page.getByText("E2E title").first()).toBeVisible();

    // The edits survive a reload.
    await page.reload();
    await expect(page.getByRole("group", { name: "Format" }).getByRole("button", { name: "1:1 Square" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Title text")).toHaveValue("E2E title");

    // Export with the real ffmpeg pipeline and check the file.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = page.getByRole("link", { name: /^Download/ });
    await expect(download).toBeVisible({ timeout: 150_000 });
    await shot(page, "13-editor-exported");
    const href = await download.getAttribute("href");
    expect(href).toBeTruthy();
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("video/mp4");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    mkdirSync("test-results", { recursive: true });
    const file = path.join("test-results", "export.mp4");
    writeFileSync(file, await res.body());
    const info = probe(file);
    expect(info).toMatchObject({ width: 1080, height: 1080, hasAudio: true });
    expect(info.duration).toBeGreaterThan(8);

    // Seeking works: the source answers range requests.
    const range = await page.request.get(`${new URL(projectUrl).pathname.replace("/projects/", "/api/projects/")}/source`, { headers: { Range: "bytes=0-99" } });
    expect(range.status()).toBe(206);
    expect((await range.body()).length).toBe(100);

    // Editing after export marks the file as out of date.
    await page.getByRole("group", { name: "Format" }).getByRole("button", { name: "16:9 Wide" }).click();
    await expect(page.getByRole("button", { name: "Export again" })).toBeVisible();

    // Back to the project: delete the hand-marked clip.
    await page.goto(projectUrl);
    await page.getByRole("button", { name: "Delete Clip at 0:02" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete clip" }).click();
    await expect(cards).toHaveCount(aiCount);

    // Delete the whole project from the list.
    await page.goto("/projects");
    const title = "sample-talk";
    const card = page.getByRole("listitem").filter({ hasText: title }).first();
    await expect(card).toBeVisible();
    // The thumbnail made during import loads.
    await expect.poll(() => card.locator("img").evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await shot(page, "14-projects");
    const before = await page.getByRole("listitem").filter({ hasText: title }).count();
    await card.hover();
    await card.getByRole("button", { name: `Delete ${title}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete project" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: title })).toHaveCount(before - 1);
    expect((await page.request.get(new URL(projectUrl).pathname.replace("/projects/", "/api/projects/"))).status()).toBe(404);
  });
});

test.describe("live link import", () => {
  test.skip(!process.env.E2E_LIVE, "Set E2E_LIVE=1 to import a real YouTube video (needs internet and yt-dlp).");

  test("imports part of a YouTube video and exports a clip", async ({ page }) => {
    await signIn(page);
    await page.goto("/new");
    await page.getByLabel("Video link").fill("https://www.youtube.com/watch?v=jNQXAC9IVRw");
    await expect(page.getByText("Me at the zoo")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("switch", { name: "Import only part of the video" }).check();
    await page.getByRole("textbox", { name: "From", exact: true }).fill("0:02");
    await page.getByRole("textbox", { name: "To", exact: true }).fill("0:16");
    await page.getByRole("button", { name: /^Import/ }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    await expect(page.getByRole("heading", { name: /Clips/ })).toBeVisible({ timeout: 180_000 });
    await page.getByLabel("Start").fill("0:01");
    await page.getByLabel("End").fill("0:07");
    await page.getByRole("button", { name: "Add clip" }).click();
    const card = page.getByTestId("clip-card").filter({ hasText: "Clip at 0:01" });
    await card.getByRole("button", { name: "Export" }).click();
    await expect(card.getByRole("link", { name: /^Download/ })).toBeVisible({ timeout: 150_000 });
    expect((await page.request.delete(new URL(page.url()).pathname.replace("/projects/", "/api/projects/"))).status()).toBe(204);
  });
});
