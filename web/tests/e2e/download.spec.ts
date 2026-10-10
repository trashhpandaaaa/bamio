import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { signIn } from "./auth";
import { canDecodeSample } from "./editor-helpers";

/*
 * The downloader (/download): a link in, a file out. It needs a sign-in, and turns YouTube away
 * before anything is asked of the server. Fetching a real video needs the internet, so that
 * part is opt-in:
 *   E2E_DOWNLOAD_URL=https://download.samplelib.com/mp4/sample-5s.mp4 npx playwright test download
 * (a link to a short video anyone may fetch). E2E_SCREENSHOTS=1 also saves screenshots to qa/screens/.
 */

const shot = async (page: import("@playwright/test").Page, name: string) => {
  if (!process.env.E2E_SCREENSHOTS) return;
  mkdirSync("qa/screens", { recursive: true });
  await page.screenshot({ path: `qa/screens/${name}.png`, fullPage: true });
};

test("the downloader needs a sign-in, like the rest of the app", async ({ page }) => {
  await page.goto("/download");
  await expect(page).toHaveURL(/\/sign-in/);
});

test.describe("the downloader", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("is in the app's menu, says what it takes, and turns YouTube and bad links away", async ({ page }) => {
    await page.goto("/download");
    await expect(page.getByRole("heading", { name: "Download a video", level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Downloader" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Only download videos you own or have permission to use.")).toBeVisible();
    await expect(page.getByText(/Videos of up to 60 minutes, \d+ more today\. Not YouTube/)).toBeVisible();
    const start = page.getByRole("button", { name: "Download", exact: true });
    await expect(start).toBeDisabled();

    // YouTube: refused on the page, with nothing sent to the server.
    const asked: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/downloads") asked.push(r.url());
    });
    const link = page.getByLabel("Link to the video");
    // The page's own message (Next keeps an announcer for screen readers with the same role, outside main).
    const told = page.getByRole("main").getByRole("alert");
    await link.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await start.click();
    await expect(told).toHaveText("Bamio doesn’t download from YouTube. To clip a YouTube video, paste the link under Import instead.");
    await link.fill("https://youtu.be/dQw4w9WgXcQ");
    await start.click();
    await expect(told).toContainText("doesn’t download from YouTube");
    await link.fill("not a link");
    await start.click();
    await expect(told).toContainText("doesn’t look like a link");
    expect(asked).toEqual([]);
    // The server says the same to someone who goes around the page.
    const direct = await page.request.post("/api/downloads", { data: { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } });
    expect(direct.status()).toBe(422);
    expect((await direct.json()).error).toMatchObject({ code: "blocked_site" });
    await shot(page, "40-download");
  });

  test("fetches a video from a link, hands over the file, and opens it in the editor", async ({ page }) => {
    const url = process.env.E2E_DOWNLOAD_URL;
    test.skip(!url, "Set E2E_DOWNLOAD_URL to a short public video (it's fetched from the internet).");
    test.setTimeout(5 * 60_000);
    await page.goto("/download");
    await page.getByLabel("Link to the video").fill(url!);
    await page.getByRole("button", { name: "Download", exact: true }).click();
    const item = page.getByRole("list").getByRole("listitem").first();
    await expect(item.getByText(/Ready, kept until/)).toBeVisible({ timeout: 3 * 60_000 });
    await shot(page, "41-download-ready");

    // The file: a video, saved under the video's own name.
    const download = page.waitForEvent("download");
    await item.getByRole("link", { name: "Save the video" }).click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/\.mp4$/);
    const ffprobe = path.join(process.cwd(), "node_modules", "ffprobe-static", "bin", process.platform, process.arch, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    const probed = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type,width", "-of", "json", await saved.path()], { encoding: "utf8", windowsHide: true });
    expect((JSON.parse(probed.stdout) as { streams: { codec_type: string; width: number }[] }).streams[0]).toMatchObject({ codec_type: "video" });

    // Into the editor, as a new edit with the video in it.
    if (await canDecodeSample(page)) {
      await item.getByRole("link", { name: "Open in editor" }).click();
      await expect(page).toHaveURL(/\/editor\?edit=/, { timeout: 60_000 });
      await expect(page.getByRole("listbox", { name: "Clips" }).getByRole("option")).toHaveCount(1, { timeout: 60_000 });
      await page.getByRole("button", { name: "Edits" }).click();
      await page.getByRole("button", { name: /^Delete / }).first().click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete edit" }).click();
      await page.goto("/download");
    }

    // Off the list, and the file with it.
    const row = page.getByRole("list").getByRole("listitem").first();
    const file = await row.getByRole("link", { name: "Save the video" }).getAttribute("href");
    await row.getByRole("button", { name: /^Remove / }).click();
    await expect(page.getByText("Nothing here yet")).toBeVisible();
    expect((await page.request.get(file!)).status()).toBe(404);
  });
});
