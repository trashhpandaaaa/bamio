import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";

/*
 * Videos in other languages, end to end, with the language detected automatically:
 * import 90 s of a real YouTube video, check the detected language and the script of the
 * transcript, see the captions in the editor with the export's font, export a clip with
 * captions and a title. Saves the preview and a frame of the export to qa/languages/ for a
 * side-by-side look. Opt-in (needs internet, and downloads models and fonts the first time):
 *   E2E_LANGUAGES=1 npx playwright test languages          (or E2E_LANGUAGES=hi,ja)
 */

const CASES = [
  { lang: "hi", name: "Hindi", url: "https://www.youtube.com/watch?v=jQXBsUz0qJU", script: /\p{Script=Devanagari}/u, font: "NotoSansDevanagari-ExtraBold.ttf" },
  { lang: "ja", name: "Japanese", url: "https://www.youtube.com/watch?v=4EeTnIV05j4", script: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u, font: "NotoSansJP-Bold.otf" },
  { lang: "ar", name: "Arabic", url: "https://www.youtube.com/watch?v=S3eCRa0IudY", script: /\p{Script=Arabic}/u, font: "NotoSansArabic-ExtraBold.ttf" },
  { lang: "es", name: "Spanish", url: "https://www.youtube.com/watch?v=CHGmM4RfeIw", script: /\p{Script=Latin}/u, font: "BricolageGrotesque-ExtraBold.ttf" },
];
const wanted = process.env.E2E_LANGUAGES;
const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");

for (const c of CASES) {
  test(`${c.name}: detected, transcribed in its script, captioned and exported`, async ({ page }) => {
    test.skip(!wanted || (wanted !== "1" && !wanted.split(",").includes(c.lang)), "Set E2E_LANGUAGES=1 (or a list like hi,ja) to run.");
    test.setTimeout(20 * 60_000);
    const fonts = new Set<string>();
    page.on("response", (res) => {
      const m = /\/api\/fonts\/([^?]+)$/.exec(new URL(res.url()).pathname);
      if (m && res.status() === 200) fonts.add(decodeURIComponent(m[1]!));
    });

    await signIn(page);
    await page.goto("/new");
    await page.getByLabel("Video link").fill(c.url);
    const part = page.getByRole("switch", { name: "Import only part of the video" });
    await expect(part).toBeVisible({ timeout: 90_000 });
    await part.check();
    await page.getByRole("textbox", { name: "From", exact: true }).fill("10:00");
    await page.getByRole("textbox", { name: "To", exact: true }).fill("11:30");
    await page.getByLabel("Spoken language").selectOption("auto");
    await page.getByRole("button", { name: /^Import/ }).click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/, { timeout: 90_000 });
    const api = new URL(page.url()).pathname.replace("/projects/", "/api/projects/");
    await expect(page.getByRole("heading", { name: /Clips/ })).toBeVisible({ timeout: 15 * 60_000 });

    // Detected and transcribed on the device, in the language's own script.
    const project = (await (await page.request.get(api)).json()) as { spokenLanguage?: string; transcriptEngine?: string; hasTranscript: boolean };
    expect(project).toMatchObject({ spokenLanguage: c.lang, transcriptEngine: "device", hasTranscript: true });
    await expect(page.getByText(c.name, { exact: true })).toBeVisible();
    const transcript = (await (await page.request.get(`${api}/transcript`)).json()) as { segments: { text: string }[] };
    const letters = [...transcript.segments.map((s) => s.text).join("")].filter((ch) => /\p{L}/u.test(ch));
    expect(letters.length).toBeGreaterThan(100);
    expect(letters.filter((ch) => c.script.test(ch)).length / letters.length).toBeGreaterThan(0.9);

    // A clip with captions and a title, in the editor.
    await page.getByLabel("Start").fill("0:20");
    await page.getByLabel("End").fill("0:35");
    await page.getByRole("button", { name: "Add clip" }).click();
    const card = page.getByTestId("clip-card").filter({ hasText: "Clip at 0:20" });
    await card.getByRole("link", { name: "Edit" }).click();
    await page.waitForURL(/\/clips\/[0-9a-f-]{36}$/);
    const title = transcript.segments.find((s) => s.text.length > 12)!.text.slice(0, 40);
    await page.getByRole("switch", { name: "Show a title" }).check();
    await page.getByLabel("Title text").fill(title);
    await expect(page.getByRole("status").filter({ hasText: /Saved|Saving/ })).toHaveText(/Saved/, { timeout: 10_000 });
    await page.getByRole("button", { name: "Play", exact: true }).click();
    await expect(page.getByTestId("caption")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const sample = (await page.getByTestId("caption").textContent()) ?? "";
    expect(sample).toMatch(c.script);
    const loaded = await page.evaluate(async (text) => {
      await document.fonts.load(`800 40px "Bamio Caption"`, text);
      return document.fonts.check(`800 40px "Bamio Caption"`, text);
    }, sample);
    expect(loaded).toBe(true);
    expect([...fonts]).toContain(c.font);
    mkdirSync("qa/languages", { recursive: true });
    await page.locator("video").first().locator("..").screenshot({ path: `qa/languages/${c.lang}-preview.png` });

    // Export, and keep a frame for a look next to the preview.
    await page.getByRole("button", { name: "Export", exact: true }).click();
    const download = page.getByRole("link", { name: /^Download/ });
    await expect(download).toBeVisible({ timeout: 300_000 });
    const res = await page.request.get((await download.getAttribute("href"))!);
    expect(res.status()).toBe(200);
    const file = path.join("test-results", `export-${c.lang}.mp4`);
    mkdirSync("test-results", { recursive: true });
    writeFileSync(file, await res.body());
    const frame = spawnSync(ffmpeg, ["-v", "error", "-y", "-ss", "2.4", "-i", file, "-frames:v", "1", "-update", "1", `qa/languages/${c.lang}-export.png`], { windowsHide: true });
    expect(frame.status).toBe(0);

    expect((await page.request.delete(api)).status()).toBe(204);
  });
}
