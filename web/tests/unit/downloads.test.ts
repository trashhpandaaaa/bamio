import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { InspectResult } from "@/lib/clips/schema";
import { blockedSite, DOWNLOAD_LIMITS, fileSize, linkProblem, NO_YOUTUBE } from "@/lib/downloads/schema";
import { db } from "@/lib/server/db";
import { downloadKey, downloadNext, listDownloads, removeDownload, serveDownload, startDownload, sweepDownloads, type DownloadDeps, type FetchVideo } from "@/lib/server/downloads";
import { HttpError } from "@/lib/server/http";
import { explainYtdlpError } from "@/lib/server/media";
import { storage } from "@/lib/server/storage";

/* The downloader: which links it takes, what an account may start, and what the workers do with a download. */

const ADA = "user_dl_ada";
const BEN = "user_dl_ben";
const HOUR = 3600_000;

describe("which links the downloader takes", () => {
  it("turns YouTube away, however the link is written, and takes other sites", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=abc",
      "https://youtube.com/shorts/abc",
      "https://m.youtube.com/watch?v=abc",
      "https://music.youtube.com/watch?v=abc",
      "https://youtu.be/abc",
      "https://www.youtube-nocookie.com/embed/abc",
      "https://rr3---sn-abc.googlevideo.com/videoplayback?id=1",
      "HTTPS://WWW.YOUTUBE.COM/watch?v=abc",
    ]) {
      expect(blockedSite(new URL(link)), link).toBe(NO_YOUTUBE);
      expect(linkProblem(link), link).toBe(NO_YOUTUBE);
    }
    for (const link of ["https://www.tiktok.com/@a/video/1", "https://vimeo.com/1", "https://example.com/a.mp4", "https://notyoutube.com/v", "https://youtube.com.example.org/v"]) {
      expect(blockedSite(new URL(link)), link).toBeNull();
      expect(linkProblem(link), link).toBeNull();
    }
    expect(NO_YOUTUBE).toContain("Import");
  });

  it("says what's wrong with something that isn't a link to a site", () => {
    expect(linkProblem("tiktok")).toContain("doesn’t look like a link");
    expect(linkProblem("ftp://example.com/a.mp4")).toContain("http");
    expect(linkProblem("http://localhost/a.mp4")).toContain("public internet");
    expect(linkProblem("http://192.168.1.4/a.mp4")).toContain("public internet");
  });

  it("never tells someone downloading to upload the file instead", () => {
    const answers = ["Unsupported URL", "confirm you’re not a bot", "ERROR: This video is DRM protected", "Private video. Sign in", "HTTP Error 403: Forbidden", "Video unavailable", "timed out", "something nobody has seen before"];
    for (const stderr of answers) {
      expect(explainYtdlpError(stderr, "download"), stderr).not.toMatch(/upload/i);
      expect(explainYtdlpError(stderr, "download").length, stderr).toBeGreaterThan(20);
    }
    // An import still can: the file is another way in.
    expect(explainYtdlpError("HTTP Error 403: Forbidden")).toMatch(/upload/i);
  });

  it("writes a file's size for people", () => {
    expect(fileSize(12_400_000)).toBe("12.4 MB");
    expect(fileSize(1_240_000_000)).toBe("1.2 GB");
  });
});

describe("a download", () => {
  let dir: string;
  const found = (over: Partial<InspectResult> = {}): InspectResult => ({ url: "https://www.tiktok.com/@a/video/123", platform: "other", title: "A dance", durationSec: 42, thumbnail: "https://img.example.com/1.jpg", ...over });
  const deps = (over: Partial<InspectResult> = {}, calls: string[] = []): DownloadDeps => ({
    inspect: async (url) => {
      calls.push(url);
      return found(over);
    },
    room: async () => undefined,
  });
  /** A stand-in for yt-dlp: writes a small file where a download would land. */
  const fetches =
    (name = "download.mp4", body = "video"): FetchVideo =>
    async (_url, folder, opts) => {
      await mkdir(folder, { recursive: true });
      opts.onProgress(0.5);
      const file = path.join(folder, name);
      await writeFile(file, body);
      return file;
    };
  const row = async (id: string) => (await db()`select status, error, attempts, size_bytes::int as size, progress, removed_at, expires_at::float8 as expires_at from downloads where id = ${id}`)[0];
  const clean = () => db()`delete from downloads where user_id in ${db()([ADA, BEN])}`;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bamio-downloads-"));
    process.env.BAMIO_DATA_DIR = path.join(dir, "data");
    process.env.BAMIO_WORK_DIR = path.join(dir, "work");
  });
  afterAll(async () => {
    await clean();
    delete process.env.BAMIO_DATA_DIR;
    delete process.env.BAMIO_WORK_DIR;
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(clean);

  it("is taken when the link, the video and the account's limits allow, and waits for the downloader", async () => {
    const asked: string[] = [];
    const made = await startDownload(ADA, "  https://vm.tiktok.com/abc  ", deps({}, asked), 1000);
    expect(asked).toEqual(["https://vm.tiktok.com/abc"]);
    // Kept under the page the site names, not the short link that was pasted.
    expect(made).toMatchObject({ url: "https://www.tiktok.com/@a/video/123", title: "A dance", platform: "other", durationSec: 42, status: "queued", progress: null, error: null, sizeBytes: null, createdAt: 1000, expiresAt: null });
    expect(await listDownloads(ADA, 2000)).toEqual({ downloads: [made], leftToday: DOWNLOAD_LIMITS.perDay - 1 });
    // Nobody else's.
    expect(await listDownloads(BEN, 2000)).toEqual({ downloads: [], leftToday: DOWNLOAD_LIMITS.perDay });
  });

  it("is refused for YouTube before the site is asked, and when a short link turns out to be YouTube", async () => {
    const asked: string[] = [];
    await expect(startDownload(ADA, "https://youtu.be/abc", deps({}, asked))).rejects.toMatchObject({ status: 422, code: "blocked_site", message: NO_YOUTUBE });
    expect(asked).toEqual([]);
    await expect(startDownload(ADA, "https://short.example.com/x", deps({ url: "https://www.youtube.com/watch?v=abc", platform: "youtube" }))).rejects.toMatchObject({ code: "blocked_site" });
    await expect(startDownload(ADA, "https://short.example.com/x", deps({ url: "https://m.youtube.com/watch?v=abc", platform: "other" }))).rejects.toMatchObject({ code: "blocked_site" });
    expect((await listDownloads(ADA)).downloads).toEqual([]);
  });

  it("is refused for a live stream, a video that's too long, a bad link, or a full disk", async () => {
    await expect(startDownload(ADA, "https://www.twitch.tv/someone", deps({ live: { rewindSec: 30, canRewind: false, followBackSec: 30, followFromStart: false } }))).rejects.toMatchObject({ status: 422, code: "live" });
    await expect(startDownload(ADA, "https://vimeo.com/1", deps({ durationSec: DOWNLOAD_LIMITS.maxDurationSec + 120 }))).rejects.toMatchObject({ status: 422, code: "too_long" });
    await expect(startDownload(ADA, "not a link", deps())).rejects.toMatchObject({ status: 400, code: "bad_url" });
    const full: DownloadDeps = { ...deps(), room: async () => Promise.reject(new HttpError(507, "no_space", "No room.")) };
    await expect(startDownload(ADA, "https://vimeo.com/1", full)).rejects.toMatchObject({ status: 507 });
    // What the site says is passed on as it is.
    const closed: DownloadDeps = { ...deps(), inspect: async () => Promise.reject(new HttpError(422, "unreadable", "That video is private or needs a sign-in, so Bamio can’t download it.")) };
    await expect(startDownload(ADA, "https://www.instagram.com/reel/abc/", closed)).rejects.toMatchObject({ message: expect.stringContaining("sign-in") });
    expect((await listDownloads(ADA)).downloads).toEqual([]);
  });

  it("is limited to a few at once and so many a day, and taking one off the list doesn't give it back", async () => {
    const now = 100 * HOUR;
    for (let i = 0; i < DOWNLOAD_LIMITS.atOnce; i++) await startDownload(ADA, `https://example.com/v/${i}`, deps(), now + i);
    await expect(startDownload(ADA, "https://example.com/v/more", deps(), now + 10)).rejects.toMatchObject({ status: 429, code: "too_many" });
    // Another account isn't held up by it.
    await expect(startDownload(BEN, "https://example.com/v/0", deps(), now)).resolves.toMatchObject({ status: "queued" });

    const sql = db();
    await sql`update downloads set status = 'ready' where user_id = ${ADA}`;
    for (let i = DOWNLOAD_LIMITS.atOnce; i < DOWNLOAD_LIMITS.perDay; i++) {
      await sql`insert into downloads (id, user_id, url, title, platform, duration_sec, status, created_at) values (gen_random_uuid(), ${ADA}, 'https://example.com/v', 'V', 'other', 5, 'ready', ${now + i})`;
    }
    expect((await listDownloads(ADA, now + HOUR)).leftToday).toBe(0);
    await expect(startDownload(ADA, "https://example.com/v/last", deps(), now + HOUR)).rejects.toMatchObject({ status: 429, code: "daily_limit" });
    const { downloads } = await listDownloads(ADA, now + HOUR);
    await removeDownload(ADA, downloads[0]!.id, now + HOUR);
    await expect(startDownload(ADA, "https://example.com/v/last", deps(), now + HOUR)).rejects.toMatchObject({ code: "daily_limit" });
    // A day on, they can again.
    await expect(startDownload(ADA, "https://example.com/v/last", deps(), now + 25 * HOUR)).resolves.toMatchObject({ status: "queued" });
  });

  it("is fetched by the downloader, kept with the account's media for a day, and served only to its owner", async () => {
    const made = await startDownload(ADA, "https://example.com/v/1", deps());
    const before = Date.now();
    expect(await downloadNext(fetches("download.mp4", "the video"))).toBe(true);
    expect(await downloadNext(fetches())).toBe(false);
    const done = await row(made.id);
    expect(done).toMatchObject({ status: "ready", error: null, size: 9, progress: 1, removed_at: null, attempts: 1 });
    expect(done!.expires_at).toBeGreaterThanOrEqual(before + DOWNLOAD_LIMITS.keepHours * HOUR);
    expect(await storage().stat(downloadKey(ADA, made.id))).toEqual({ size: 9 });

    const request = new Request(`http://localhost/api/downloads/${made.id}/file`);
    const saved = await serveDownload(request, ADA, made.id);
    expect(saved.status).toBe(200);
    expect(saved.headers.get("content-type")).toBe("video/mp4");
    expect(saved.headers.get("content-disposition")).toContain("A-dance.mp4");
    expect(await saved.text()).toBe("the video");
    // For the editor: the same file, without "save as".
    expect((await serveDownload(request, ADA, made.id, true)).headers.get("content-disposition") ?? "").not.toContain("attachment");
    await expect(serveDownload(request, BEN, made.id)).rejects.toMatchObject({ status: 404 });
    await expect(serveDownload(request, ADA, "../../etc/passwd")).rejects.toMatchObject({ status: 404 });
    // Once its day is up it isn't served, even before the sweep comes by.
    await expect(serveDownload(request, ADA, made.id, false, Date.now() + 25 * HOUR)).rejects.toMatchObject({ status: 404, code: "not_ready" });

    await removeDownload(ADA, made.id);
    expect(await storage().stat(downloadKey(ADA, made.id))).toBeNull();
    await expect(serveDownload(request, ADA, made.id)).rejects.toMatchObject({ status: 404 });
    await expect(removeDownload(ADA, made.id)).rejects.toMatchObject({ status: 404 });
    await expect(removeDownload(BEN, made.id)).rejects.toMatchObject({ status: 404 });
  });

  it("fails with the site's own reason, tries again when the fault may pass, and won't save sound alone", async () => {
    const refused = await startDownload(ADA, "https://example.com/v/1", deps());
    await downloadNext(async () => Promise.reject(new HttpError(422, "download_failed", "That video is private or needs a sign-in, so Bamio can’t download it.")));
    expect(await row(refused.id)).toMatchObject({ status: "failed", error: "That video is private or needs a sign-in, so Bamio can’t download it.", attempts: 1 });
    await removeDownload(ADA, refused.id);

    // Something of Bamio's own: three tries, then it says so without the details.
    const broken = await startDownload(ADA, "https://example.com/v/2", deps());
    const crash: FetchVideo = async () => Promise.reject(new Error("disk on fire"));
    const quiet = console.error;
    console.error = () => undefined;
    try {
      await downloadNext(crash);
      expect(await row(broken.id)).toMatchObject({ status: "queued", attempts: 1 });
      await downloadNext(crash);
      await downloadNext(crash);
    } finally {
      console.error = quiet;
    }
    expect(await row(broken.id)).toMatchObject({ status: "failed", error: "Something went wrong on our side. Try again.", attempts: 3 });
    await removeDownload(ADA, broken.id);

    const sound = await startDownload(ADA, "https://example.com/v/3", deps());
    await downloadNext(fetches("download.m4a"));
    expect(await row(sound.id)).toMatchObject({ status: "failed", error: expect.stringContaining("no video") });
    expect(await storage().stat(downloadKey(ADA, sound.id))).toBeNull();
  });

  it("goes back in the queue when the worker stops, and stops being fetched when its owner takes it off the list", async () => {
    const waitForAbort: FetchVideo = (_url, _folder, opts) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        if (opts.signal.aborted) abort();
        else opts.signal.addEventListener("abort", abort);
      });
    const made = await startDownload(ADA, "https://example.com/v/1", deps());
    const stopping = new AbortController();
    const running = downloadNext(waitForAbort, stopping.signal);
    stopping.abort();
    expect(await running).toBe(true);
    // Not counted as a try: it wasn't the download's fault.
    expect(await row(made.id)).toMatchObject({ status: "queued", attempts: 0 });

    // Taken off the list part way: the fetch is told to stop as soon as it next says how far along it is.
    const removing: FetchVideo = async (url, folder, opts) => {
      await removeDownload(ADA, made.id);
      opts.onProgress(0.4);
      return waitForAbort(url, folder, opts);
    };
    expect(await downloadNext(removing)).toBe(true);
    const gone = await row(made.id);
    expect(gone!.removed_at).not.toBeNull();
    expect(await storage().stat(downloadKey(ADA, made.id))).toBeNull();
    expect((await listDownloads(ADA)).downloads).toEqual([]);
    expect(await downloadNext(fetches())).toBe(false);
  });

  it("is taken over when its worker died, and given up on when that keeps happening", async () => {
    const made = await startDownload(ADA, "https://example.com/v/1", deps());
    const sql = db();
    // Claimed, then nothing: its hold ran out.
    await sql`update downloads set status = 'working', attempts = 1, lease_until = ${Date.now() - 1000} where id = ${made.id}`;
    expect(await downloadNext(fetches())).toBe(true);
    expect(await row(made.id)).toMatchObject({ status: "ready", attempts: 2 });

    const cursed = await startDownload(ADA, "https://example.com/v/2", deps());
    await sql`update downloads set status = 'working', attempts = 3, lease_until = ${Date.now() - 1000} where id = ${cursed.id}`;
    let called = false;
    await downloadNext(async (...args) => {
      called = true;
      return fetches()(...args);
    });
    expect(called).toBe(false);
    expect(await row(cursed.id)).toMatchObject({ status: "failed", error: expect.stringContaining("couldn’t download") });
  });

  it("is deleted when its day is up, and forgotten a few days on", async () => {
    const kept = await startDownload(ADA, "https://example.com/v/1", deps());
    const failed = await startDownload(ADA, "https://example.com/v/2", deps());
    await downloadNext(fetches());
    await downloadNext(async () => Promise.reject(new HttpError(422, "download_failed", "No.")));
    const now = Date.now();
    // Nothing is due yet.
    expect(await sweepDownloads(now + HOUR)).toBe(0);
    expect((await listDownloads(ADA)).downloads).toHaveLength(2);

    expect(await sweepDownloads(now + (DOWNLOAD_LIMITS.keepHours + 1) * HOUR)).toBe(2);
    expect(await storage().stat(downloadKey(ADA, kept.id))).toBeNull();
    expect((await listDownloads(ADA)).downloads).toEqual([]);
    // The rows stay for the day's count, then go.
    expect((await db()`select 1 from downloads where id in ${db()([kept.id, failed.id])}`).length).toBe(2);
    await sweepDownloads(now + 80 * HOUR);
    expect((await db()`select 1 from downloads where id in ${db()([kept.id, failed.id])}`).length).toBe(0);
  });
});
