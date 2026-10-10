import "server-only";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { InspectResult, Platform } from "@/lib/clips/schema";
import { parseVideoUrl } from "@/lib/clips/url";
import { blockedSite, DOWNLOAD_LIMITS, NO_YOUTUBE, type Download, type DownloadList, type DownloadStatus } from "@/lib/downloads/schema";
import { isAbortError } from "@/lib/server/bin";
import { db } from "@/lib/server/db";
import { attachmentName, HttpError } from "@/lib/server/http";
import { assertDiskSpace } from "@/lib/server/jobs";
import { downloadUrl, inspectCached } from "@/lib/server/media";
import { reportError } from "@/lib/server/monitor";
import { storage } from "@/lib/server/storage";
import { isProjectId, isUserId, userMediaPrefix, workRoot } from "@/lib/server/store";

/*
 * The downloader (/download): a signed-in person pastes a link to a video on another site and
 * saves the file. Free for every account. The server fetches the video the way an import does
 * (yt-dlp, media.ts), puts the file with the account's own media (storage.ts) and keeps it for
 * a day; then the sweep deletes it. Not YouTube: see lib/downloads/schema.ts.
 *
 * The downloads table is its own queue, like the email outbox: a download isn't a project, and
 * jobs belong to projects. A route only writes a row; the workers' downloader (startDownloader,
 * started with the job worker) claims rows by lease and does the fetching, so a download
 * survives a restart and another worker takes over one whose worker died.
 *
 * What protects the server: a video's length, how many an account starts in a day and has going
 * at once (DOWNLOAD_LIMITS), a few at a time for everyone (BAMIO_DOWNLOAD_SLOTS, 2), and room
 * on the disk, checked before a download is taken.
 */

const HOUR = 3600_000;
export const DOWNLOADS_CHANNEL = "bamio_downloads";
/** A worker renews its hold every few seconds while it fetches; one silent this long has died. */
const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;
/** Never taken by downloads: the database lives on the same disk. */
const RESERVE_BYTES = 3 * 1024 ** 3;
/** About what a second of 1080p video weighs, for the room a download will need. */
const BYTES_PER_SEC = 1_000_000;

const notFound = () => new HttpError(404, "not_found", "That download doesn’t exist.");

/** Where a download's file is kept: with the account's own media, so deleting the account deletes it. Both ids are checked. */
export function downloadKey(userId: string, id: string): string {
  if (!isProjectId(id)) throw notFound();
  return `${userMediaPrefix(userId)}/downloads/${id.toLowerCase()}.mp4`;
}

/** Where a download is fetched to before it's published. */
const workDir = (id: string) => path.join(workRoot(), "downloads", id.toLowerCase());

type Row = {
  id: string;
  user_id: string;
  url: string;
  title: string;
  platform: string;
  duration_sec: number;
  thumbnail: string | null;
  status: DownloadStatus;
  progress: number | null;
  error: string | null;
  size_bytes: string | number | null;
  created_at: number;
  expires_at: number | null;
};

const forOwner = (r: Row): Download => ({
  id: r.id,
  url: r.url,
  title: r.title,
  platform: r.platform as Platform,
  durationSec: Number(r.duration_sec),
  thumbnail: r.thumbnail,
  status: r.status,
  progress: r.progress === null ? null : Number(r.progress),
  error: r.error,
  sizeBytes: r.size_bytes === null ? null : Number(r.size_bytes),
  createdAt: Number(r.created_at),
  expiresAt: r.expires_at === null ? null : Number(r.expires_at),
});

const cols = (sql: ReturnType<typeof db>) =>
  sql`id, user_id, url, title, platform, duration_sec, thumbnail, status, progress, error, size_bytes, created_at::float8 as created_at, expires_at::float8 as expires_at`;

/** The account's downloads, newest first, and how many more it may start today. */
export async function listDownloads(userId: string, now = Date.now()): Promise<DownloadList> {
  if (!isUserId(userId)) return { downloads: [], leftToday: 0 };
  const sql = db();
  const rows = await sql<Row[]>`select ${cols(sql)} from downloads where user_id = ${userId} and removed_at is null order by created_at desc limit 50`;
  // Counted over every download started, kept or not: taking one off the list doesn't give it back.
  const [count] = await sql<{ n: number }[]>`select count(*)::int as n from downloads where user_id = ${userId} and created_at > ${now - 24 * HOUR}`;
  return { downloads: rows.map(forOwner), leftToday: Math.max(0, DOWNLOAD_LIMITS.perDay - (count?.n ?? 0)) };
}

export type DownloadDeps = {
  /** A link's title, length and page, as the site says (media.ts). */
  inspect: (url: string) => Promise<InspectResult>;
  /** Throws when the disk hasn't this many bytes to spare. */
  room: (bytes: number) => Promise<void>;
};

const defaultDeps: DownloadDeps = {
  inspect: (url) => inspectCached(url, "download"),
  room: async (bytes) => {
    try {
      await assertDiskSpace(bytes);
    } catch (err) {
      // The import's message is about projects; this isn't one.
      if (err instanceof HttpError && err.code === "no_space") throw new HttpError(507, "no_space", "Bamio’s server is short of room right now. Try again in a while.");
      throw err;
    }
  },
};

/**
 * Take a link for downloading: checked (a public address, not YouTube, not live, not too long,
 * within the account's limits, room on the disk), then left for the downloader. Returns it as
 * its owner sees it.
 */
export async function startDownload(userId: string, input: string, deps: DownloadDeps = defaultDeps, now = Date.now()): Promise<Download> {
  if (!isUserId(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  const check = parseVideoUrl(input);
  if (!check.ok) throw new HttpError(400, "bad_url", check.message);
  const blocked = blockedSite(check.url);
  if (blocked) throw new HttpError(422, "blocked_site", blocked);

  const sql = db();
  const limits = async () => {
    const [n] = await sql<{ today: number; active: number }[]>`
      select count(*) filter (where created_at > ${now - 24 * HOUR})::int as today,
             count(*) filter (where status in ('queued', 'working') and removed_at is null)::int as active
      from downloads where user_id = ${userId}`;
    if ((n?.active ?? 0) >= DOWNLOAD_LIMITS.atOnce) {
      throw new HttpError(429, "too_many", `You have ${DOWNLOAD_LIMITS.atOnce} downloads going. Wait for one to finish, then add the next.`);
    }
    if ((n?.today ?? 0) >= DOWNLOAD_LIMITS.perDay) {
      throw new HttpError(429, "daily_limit", `That’s ${DOWNLOAD_LIMITS.perDay} downloads in a day, the most an account can start. Try again tomorrow.`);
    }
  };
  // Before the site is asked anything, and again with the row.
  await limits();

  const found = await deps.inspect(check.url.href);
  // The site may say the video's page is somewhere else (a short link, a redirect): YouTube isn't taken that way either.
  const page = parseVideoUrl(found.url);
  const blockedPage = found.platform === "youtube" ? NO_YOUTUBE : page.ok ? blockedSite(page.url) : null;
  if (blockedPage) throw new HttpError(422, "blocked_site", blockedPage);
  if (found.live) throw new HttpError(422, "live", "That’s a live stream. To capture one, paste the link under Import.");
  if (found.durationSec > DOWNLOAD_LIMITS.maxDurationSec + 1) {
    throw new HttpError(422, "too_long", `That video is ${Math.ceil(found.durationSec / 60)} minutes long. The downloader takes videos of up to ${DOWNLOAD_LIMITS.maxDurationSec / 60} minutes.`);
  }
  // Twice the file: once while it's fetched, once where it's kept.
  await deps.room(RESERVE_BYTES + Math.max(60, found.durationSec) * BYTES_PER_SEC * 2);

  const id = randomUUID();
  const row = await sql.begin(async (tx) => {
    // One account's requests in turn, so two at once can't both slip under the limits.
    await tx`select pg_advisory_xact_lock(hashtext(${`bamio-download:${userId}`}))`;
    await limits();
    const [made] = await tx<Row[]>`
      insert into downloads (id, user_id, url, title, platform, duration_sec, thumbnail, created_at)
      values (${id}, ${userId}, ${found.url}, ${found.title}, ${found.platform}, ${found.durationSec}, ${found.thumbnail ?? null}, ${now})
      returning id, user_id, url, title, platform, duration_sec, thumbnail, status, progress, error, size_bytes, created_at::float8 as created_at, expires_at::float8 as expires_at`;
    return made!;
  });
  await sql`select pg_notify(${DOWNLOADS_CHANNEL}, '')`;
  return forOwner(row);
}

/** Take a download off the list and delete its file. One still being fetched is stopped by its worker within moments. */
export async function removeDownload(userId: string, id: string, now = Date.now()): Promise<void> {
  if (!isUserId(userId) || !isProjectId(id)) throw notFound();
  const done = await db()`update downloads set removed_at = ${now}, lease_until = null where id = ${id} and user_id = ${userId} and removed_at is null returning id`;
  if (done.length === 0) throw notFound();
  await storage().remove(downloadKey(userId, id)).catch(() => undefined);
}

/** The finished file, for saving (or, with `view`, for reading in the browser: the editor opens it that way). */
export async function serveDownload(req: Request, userId: string, id: string, view = false, now = Date.now()): Promise<Response> {
  if (!isUserId(userId) || !isProjectId(id)) throw notFound();
  const [row] = await db()<{ title: string; status: DownloadStatus; expires_at: number | null }[]>`
    select title, status, expires_at::float8 as expires_at from downloads where id = ${id} and user_id = ${userId} and removed_at is null`;
  if (!row) throw notFound();
  if (row.status !== "ready" || (row.expires_at !== null && row.expires_at <= now)) throw new HttpError(404, "not_ready", "That download isn’t ready, or its day is up.");
  return storage().serve(req, downloadKey(userId, id), { type: "video/mp4", downloadName: view ? undefined : attachmentName(row.title, "mp4") });
}

/* ------------------------------ The downloader ------------------------------ */

/** Fetch a video into a folder and say where the file is (media.ts's downloadUrl; a stand-in in tests). */
export type FetchVideo = (url: string, dir: string, opts: { signal: AbortSignal; onProgress: (p: number | null) => void }) => Promise<string>;

const fetchVideo: FetchVideo = (url, dir, opts) => downloadUrl(url, dir, { ...opts, purpose: "download" });

/** Claim the download that has waited longest and fetch it. False when none is waiting. */
export async function downloadNext(fetch: FetchVideo = fetchVideo, signal?: AbortSignal, now = Date.now()): Promise<boolean> {
  const sql = db();
  const [row] = await sql<{ id: string; user_id: string; url: string; attempts: number }[]>`
    update downloads set status = 'working', attempts = attempts + 1, lease_until = ${now + LEASE_MS}, progress = null
    where id = (
      select id from downloads
      where removed_at is null and (status = 'queued' or (status = 'working' and lease_until < ${now}))
      order by created_at
      limit 1
      for update skip locked
    )
    returning id, user_id, url, attempts`;
  if (!row) return false;
  const fail = (message: string) =>
    sql`update downloads set status = 'failed', error = ${message}, progress = null, lease_until = null, finished_at = ${Date.now()} where id = ${row.id}`;
  // Its worker died that many times: something about this one kills the fetch.
  if (row.attempts > MAX_ATTEMPTS) {
    await fail("Bamio couldn’t download that video. Try again, or try another link to it.");
    return true;
  }

  const dir = workDir(row.id);
  const key = downloadKey(row.user_id, row.id);
  const stopper = new AbortController();
  const stop = () => stopper.abort();
  signal?.addEventListener("abort", stop);
  if (signal?.aborted) stop();
  let removed = false;
  let last = 0;
  let progress: number | null = null;
  /** Keep hold of the row, say how far along it is, and notice if its owner took it off the list. */
  const renew = () => {
    last = Date.now();
    void sql`update downloads set progress = ${progress}, lease_until = ${last + LEASE_MS} where id = ${row.id} and removed_at is null returning id`.then(
      (kept) => {
        if (kept.length > 0) return;
        removed = true;
        stop();
      },
      () => undefined,
    );
  };
  // Also while the site says nothing (joining the picture and the sound, at the end).
  const beat = setInterval(renew, 20_000);
  try {
    const file = await fetch(row.url, dir, {
      signal: stopper.signal,
      onProgress: (p) => {
        progress = p;
        if (Date.now() - last >= 2000) renew();
      },
    });
    // Sound with no picture comes as a sound file: this saves videos.
    if (!file.toLowerCase().endsWith(".mp4")) throw new HttpError(422, "no_video", "That link has no video Bamio can save as an MP4.");
    const size = await storage().publish(key, file, "video/mp4");
    const done = Date.now();
    const kept = await sql`
      update downloads set status = 'ready', progress = 1, size_bytes = ${size}, error = null, lease_until = null, finished_at = ${done}, expires_at = ${done + DOWNLOAD_LIMITS.keepHours * HOUR}
      where id = ${row.id} and removed_at is null returning id`;
    // Taken off the list while it was being stored.
    if (kept.length === 0) await storage().remove(key).catch(() => undefined);
  } catch (err) {
    if (removed) {
      // Its owner took it off the list: nothing to keep.
    } else if (isAbortError(err) || stopper.signal.aborted) {
      // The worker is stopping: back in the queue for the next one, without counting the try.
      await sql`update downloads set status = 'queued', attempts = greatest(0, attempts - 1), progress = null, lease_until = null where id = ${row.id}`;
    } else if (err instanceof HttpError && err.status < 500) {
      // The site's answer: trying again won't change it.
      await fail(err.message);
    } else if (row.attempts < MAX_ATTEMPTS) {
      console.error(`[bamio/downloads] download ${row.id} failed (attempt ${row.attempts}), trying again:`, err);
      await sql`update downloads set status = 'queued', progress = null, lease_until = null where id = ${row.id}`;
    } else {
      reportError(err, "a download failed", { downloadId: row.id, attempts: row.attempts });
      await fail("Something went wrong on our side. Try again.");
    }
  } finally {
    clearInterval(beat);
    signal?.removeEventListener("abort", stop);
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => undefined);
  }
  return true;
}

/**
 * Tidy up: files whose day is up are deleted and leave the list, failed ones leave it after a
 * day, and rows are forgotten after three (they're kept that long for the day's count).
 */
export async function sweepDownloads(now = Date.now()): Promise<number> {
  const sql = db();
  const keep = DOWNLOAD_LIMITS.keepHours * HOUR;
  const due = await sql<{ id: string; user_id: string; status: DownloadStatus }[]>`
    update downloads set removed_at = ${now}
    where removed_at is null and ((status = 'ready' and expires_at <= ${now}) or (status = 'failed' and finished_at <= ${now - keep}))
    returning id, user_id, status`;
  for (const d of due) {
    if (d.status === "ready") await storage().remove(downloadKey(d.user_id, d.id)).catch(() => undefined);
  }
  await sql`delete from downloads where removed_at is not null and created_at < ${now - 72 * HOUR}`;
  return due.length;
}

export type Downloader = { stop: () => Promise<void> };

/**
 * Fetches downloads as they're asked for, a few at a time (BAMIO_DOWNLOAD_SLOTS, 2), looks
 * every half minute for ones whose worker died, and sweeps every ten. BAMIO_DOWNLOADS=off: this
 * process doesn't fetch (another may).
 */
export function startDownloader(fetch: FetchVideo = fetchVideo, opts: { slots?: number; pollMs?: number; log?: (m: string) => void } = {}): Downloader {
  if (process.env.BAMIO_DOWNLOADS === "off") return { stop: async () => undefined };
  const log = opts.log ?? ((m: string) => console.log(m));
  const id = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const slots = Math.max(1, Math.floor(Number(process.env.BAMIO_DOWNLOAD_SLOTS) || opts.slots || 2));
  const stopper = new AbortController();
  const running = new Set<Promise<void>>();
  let stopping = false;
  let quietUntil = 0;
  const complain = (what: string, err: unknown) => {
    if (stopping || Date.now() < quietUntil) return;
    log(`[bamio/downloads] ${id} can't ${what}: ${err instanceof Error ? err.message : String(err)}`);
    quietUntil = Date.now() + 60_000;
  };

  function kick() {
    while (!stopping && running.size < slots) {
      const one: Promise<void> = (async () => {
        try {
          while (!stopping && (await downloadNext(fetch, stopper.signal))) {
            // The next one.
          }
        } catch (err) {
          complain("fetch downloads", err);
        }
      })().finally(() => {
        running.delete(one);
      });
      running.add(one);
    }
  }
  const sweep = () => void sweepDownloads().catch((err: unknown) => complain("sweep downloads", err));

  const listening = db()
    .listen(DOWNLOADS_CHANNEL, () => kick())
    .catch(() => null);
  const poll = setInterval(kick, opts.pollMs ?? 30_000);
  const tidy = setInterval(sweep, 10 * 60_000);
  poll.unref?.();
  tidy.unref?.();
  kick();
  sweep();

  return {
    async stop() {
      stopping = true;
      clearInterval(poll);
      clearInterval(tidy);
      stopper.abort();
      await (await listening)?.unlisten().catch(() => undefined);
      await Promise.all([...running]);
    },
  };
}
