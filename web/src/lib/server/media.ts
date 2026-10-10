import "server-only";
import { CONTACT_EMAIL } from "@/lib/contact";
import { existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { parseFfmpegProgress, parseYtdlpProgress } from "@/lib/clips/progress";
import { renderArgs, type RenderPlan } from "@/lib/clips/render";
import { detectPlatform, isPrivateAddress, parseVideoUrl, playerUrl } from "@/lib/clips/url";
import { LIMITS, type InspectResult } from "@/lib/clips/schema";
import { binPath, isAbortError, ProcessError, run } from "@/lib/server/bin";
import { downloadIndexedPart } from "@/lib/server/dash";
import { HttpError } from "@/lib/server/http";

/** rename(), retried briefly: Windows refuses while another request is still reading the target. */
async function replaceFile(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 10 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
    }
  }
}

/* ------------------------------ Links ------------------------------ */

/** Parse a pasted link and make sure its host resolves only to public addresses. */
export async function checkPublicUrl(input: string): Promise<URL> {
  const check = parseVideoUrl(input);
  if (!check.ok) throw new HttpError(400, "bad_url", check.message);
  const host = check.url.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(host)) {
    let addresses: { address: string }[];
    try {
      addresses = await lookup(host, { all: true, verbatim: true });
    } catch {
      throw new HttpError(400, "bad_url", "We couldn’t find that site. Check the link.");
    }
    if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
      throw new HttpError(400, "bad_url", "That address isn’t on the public internet.");
    }
  }
  return check.url;
}

function requireYtdlp() {
  if (!binPath("yt-dlp")) {
    throw new HttpError(503, "no_ytdlp", "Importing links needs yt-dlp. In web/, run npm run setup:media, then restart the server.");
  }
}

let cookiesWarned = false;

/**
 * YTDLP_COOKIES: a cookies.txt (Netscape format) from a spare YouTube account. YouTube asks
 * servers in data centres to sign in ("confirm you're not a bot"); with these cookies yt-dlp
 * is signed in. yt-dlp writes refreshed cookies back, so the file must be writable. How to
 * export one: web/DEPLOY.md.
 */
function cookiesArgs(): string[] {
  const file = process.env.YTDLP_COOKIES;
  if (!file) return [];
  if (existsSync(file)) return ["--cookies", file];
  if (!cookiesWarned) console.warn(`[bamio/media] YTDLP_COOKIES is set, but ${file} doesn’t exist; YouTube may ask for a sign-in`);
  cookiesWarned = true;
  return [];
}

/** Arguments every yt-dlp call uses. */
export const ytdlpArgs = () => ["--no-playlist", "--no-warnings", "--ignore-config", "--js-runtimes", `node:${process.execPath}`, ...cookiesArgs()];

/** What a link is wanted for: an import can fall back to uploading the file, so its messages say so; a download (downloads.ts) can't. */
export type LinkPurpose = "import" | "download";

/** Turn yt-dlp's stderr into a message the user can act on. */
export function explainYtdlpError(stderr: string, purpose: LinkPurpose = "import"): string {
  const s = stderr.toLowerCase();
  const importing = purpose === "import";
  if (s.includes("unsupported url")) return importing ? "Bamio can’t read videos from that page. Try the video’s own page, or upload the file." : "Bamio can’t read videos from that page. Try the video’s own page.";
  if (s.includes("not a bot")) {
    // For whoever runs the server: the users see the message below.
    console.warn(
      process.env.YTDLP_COOKIES
        ? "[bamio/media] YouTube asked for a sign-in despite YTDLP_COOKIES: the cookies have probably expired, export them again (web/DEPLOY.md)"
        : "[bamio/media] YouTube asked for a sign-in: set YTDLP_COOKIES (web/DEPLOY.md)",
    );
    return importing ? "The site asked for a sign-in to prove this isn’t a bot. Try again later, or download the video and upload it." : "The site asked for a sign-in to prove this isn’t a bot. Try again later.";
  }
  if (/\bdrm\b/.test(s)) return "That video is copy-protected, so it can’t be downloaded.";
  if (
    s.includes("private video") ||
    s.includes("members-only") ||
    s.includes("subscriber") ||
    s.includes("login") ||
    s.includes("logged-in") ||
    s.includes("log in") ||
    s.includes("authentication is required") ||
    s.includes("sign in")
  ) {
    return "That video is private or needs a sign-in, so Bamio can’t download it.";
  }
  if (s.includes("confirm your age") || s.includes("age-restricted") || s.includes("inappropriate")) {
    return "That video is age-restricted, so Bamio can’t download it.";
  }
  if (s.includes("premieres in") || s.includes("upcoming") || s.includes("live event will begin")) return "That video hasn’t started yet.";
  if (s.includes("geo") && s.includes("restrict")) return "That video isn’t available in this server’s region.";
  if (s.includes("unavailable") || s.includes("removed") || s.includes("404") || s.includes("does not exist")) {
    return "That video isn’t available. Check the link opens in your browser.";
  }
  if (s.includes("error 403") || s.includes("forbidden") || s.includes("cloudflare")) {
    return importing
      ? "That site turns away downloads from servers like Bamio’s. Download the video yourself and upload the file instead."
      : "That site turns away downloads from servers like Bamio’s, so Bamio can’t fetch this video.";
  }
  if (s.includes("timed out") || s.includes("connection") || s.includes("network")) return "The site didn’t answer. Check your connection and try again.";
  return importing ? "Bamio couldn’t read that link. Check it opens in your browser, or upload the file instead." : "Bamio couldn’t read that link. Check it opens in your browser.";
}

type YtdlpInfo = {
  _type?: string;
  title?: string;
  fulltitle?: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  is_live?: boolean;
  live_status?: string;
  webpage_url?: string;
  release_timestamp?: number;
  timestamp?: number;
  /** The media file itself, when the video has one format (a direct link to a file). */
  url?: string;
  formats?: { url?: string }[];
};

/**
 * How long the media at an address is, in seconds (NaN when ffprobe can't tell). For links
 * straight to a file, whose length the site doesn't state: ffprobe reads it from the start
 * of the file.
 */
async function remoteDuration(mediaUrl: string, signal?: AbortSignal): Promise<number> {
  try {
    const url = await checkPublicUrl(mediaUrl);
    const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", "-i", url.href], { signal, timeoutMs: 45_000, collectStdout: 4096 });
    return Number(stdout.trim().split(/\s/)[0]);
  } catch (err) {
    if (isAbortError(err)) throw err;
    return NaN;
  }
}

/** Read a link's title, length and thumbnail without downloading it. `purpose`: what it's wanted for, for the wording of an error. */
export async function inspectUrl(input: string, signal?: AbortSignal, purpose: LinkPurpose = "import"): Promise<InspectResult> {
  const url = await checkPublicUrl(input);
  requireYtdlp();
  const ask = (address: URL) => run("yt-dlp", [...ytdlpArgs(), "-J", "--skip-download", "--", address.href], { signal, timeoutMs: 60_000, collectStdout: 30 * 1024 * 1024 });
  // The site's player first, where a server can read that and not the page (Vimeo): twice, since it now and
  // then answers 401 to a request it takes a moment later; the page itself if that fails too.
  const player = playerUrl(url);
  const addresses = player ? [player, player, url] : [url];
  let stdout: string | undefined;
  let failure: unknown;
  for (const [i, address] of addresses.entries()) {
    try {
      ({ stdout } = await ask(address));
      break;
    } catch (err) {
      if (isAbortError(err)) throw err;
      // The first answer says the most: the page's own, where there's a player, is "sign in" for every video.
      failure ??= err;
      if (i < addresses.length - 1) await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  if (stdout === undefined) throw new HttpError(422, "unreadable", explainYtdlpError(failure instanceof ProcessError ? failure.stderrTail : "", purpose));
  let info: YtdlpInfo;
  try {
    info = JSON.parse(stdout) as YtdlpInfo;
  } catch {
    throw new HttpError(422, "unreadable", "Bamio couldn’t read that link. Try the video’s own page.");
  }
  if (info._type === "playlist" || info._type === "multi_video") {
    throw new HttpError(422, "playlist", "That’s a playlist. Paste the link to one video.");
  }
  if (info.live_status === "post_live") {
    throw new HttpError(422, "post_live", "That stream just ended. Its replay should be ready in a few minutes.");
  }
  if (info.live_status === "is_upcoming") throw new HttpError(422, "upcoming", "That video hasn’t started yet.");
  const isLive = info.is_live === true || info.live_status === "is_live";
  const startedAt = isLive ? (info.release_timestamp ?? info.timestamp) : undefined;
  let durationSec = Number(info.duration);
  if (isLive) {
    // A live stream's length is how long it has been running (if the site says).
    durationSec = startedAt ? Math.max(0, Date.now() / 1000 - startedAt) : 0;
  } else if (!Number.isFinite(durationSec) || durationSec <= 0) {
    // A link straight to a file: the site doesn't say how long it is, the file does.
    const media = info.url ?? info.formats?.at(-1)?.url;
    durationSec = media && /^https?:\/\//.test(media) ? await remoteDuration(media, signal) : NaN;
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      throw new HttpError(422, "no_duration", `Bamio couldn’t tell how long that video is, so it can’t be ${purpose === "import" ? "imported" : "downloaded"}.`);
    }
  }
  const title = (info.title ?? info.fulltitle ?? "").trim() || "Untitled video";
  const thumb = info.thumbnail && /^https:\/\//.test(info.thumbnail) ? info.thumbnail : undefined;
  const page = info.webpage_url && /^https?:\/\//.test(info.webpage_url) ? info.webpage_url : url.href;
  if (!isLive) rememberInfo(page, stdout);
  return {
    url: page,
    platform: detectPlatform(new URL(page)),
    title: title.slice(0, LIMITS.title),
    uploader: (info.channel ?? info.uploader)?.slice(0, 200),
    durationSec,
    thumbnail: thumb,
    // How far back a capture can go is filled in by lib/server/live.ts (inspectLink).
    live: isLive ? { rewindSec: 30, canRewind: false, startedAt: startedAt ? startedAt * 1000 : undefined, followBackSec: 30, followFromStart: false } : undefined,
  };
}

/*
 * yt-dlp's full answer about a video, kept briefly so the import that usually follows a
 * lookup doesn't ask the site again (7 to 9 s each time on YouTube): the download reads it
 * with --load-info-json. Its format URLs stay valid for hours; kept for 30 minutes, the 20
 * most recent (each is up to a few MB).
 */
const infoCache: Map<string, { at: number; json: string }> = ((globalThis as { __bamioInfoJson?: Map<string, { at: number; json: string }> }).__bamioInfoJson ??= new Map());

function rememberInfo(page: string, json: string) {
  infoCache.delete(page);
  infoCache.set(page, { at: Date.now(), json });
  while (infoCache.size > 20) infoCache.delete(infoCache.keys().next().value!);
}

/** yt-dlp options to read the video from `url`, or from its remembered answer (written into `dir`). */
async function ytdlpSource(url: string, dir: string): Promise<{ args: string[]; saved: boolean }> {
  const hit = infoCache.get(url);
  if (!hit || Date.now() - hit.at > 30 * 60 * 1000) return { args: ["--", url], saved: false };
  const file = path.join(dir, "info.json");
  await writeFile(file, hit.json, "utf8");
  return { args: ["--load-info-json", file], saved: true };
}

type CachedInspect = { at: number; ttl: number; result: Promise<InspectResult> };
const inspectCache: Map<string, CachedInspect> = ((globalThis as { __bamioInspect?: Map<string, CachedInspect> }).__bamioInspect ??= new Map());

/**
 * inspectUrl, remembered for 10 minutes (live streams: 1 minute, they change) so the
 * import step doesn't ask the site twice.
 */
export function inspectCached(input: string, purpose: LinkPurpose = "import"): Promise<InspectResult> {
  const key = input.trim();
  const now = Date.now();
  const hit = inspectCache.get(key);
  if (hit && now - hit.at < hit.ttl) return hit.result;
  const result = inspectUrl(key, undefined, purpose);
  const entry: CachedInspect = { at: now, ttl: 10 * 60 * 1000, result };
  inspectCache.set(key, entry);
  result.then((r) => {
    if (r.live) entry.ttl = 60_000;
  }, () => inspectCache.delete(key));
  if (inspectCache.size > 300) {
    for (const [k, v] of inspectCache) if (now - v.at > 10 * 60 * 1000) inspectCache.delete(k);
  }
  return result;
}

/**
 * Download a link (or part of it) into `dir`. Prefers H.264/AAC up to 1080p so the
 * file usually needs no re-encode. Returns the downloaded file's path.
 */
export async function downloadUrl(
  url: string,
  dir: string,
  opts: {
    range?: { start: number; end: number };
    signal?: AbortSignal;
    onProgress?: (p: number | null) => void;
    /** What the file is wanted for, for the wording of an error. */
    purpose?: LinkPurpose;
  },
): Promise<string> {
  await checkPublicUrl(url);
  requireYtdlp();
  const ffmpeg = binPath("ffmpeg");
  if (!ffmpeg) throw new HttpError(503, "no_ffmpeg", "ffmpeg is missing. Reinstall the app’s packages (npm install).");
  await mkdir(dir, { recursive: true });

  // A part: cut at the nearest keyframe (up to a few seconds early) rather than re-encode,
  // and when it's quicker, fetch the whole file and cut it here (see partFromWholeFile).
  const range = opts.range;
  const source = await ytdlpSource(url, dir);
  let whole = false;
  if (range) {
    const chosen = await chosenFormats(source.args, opts.signal);
    // Fastest: only the part's fragments, when the files have an index (YouTube's H.264 and AAC do).
    const indexed = chosen?.formats.every((f) => f.url && (f.protocol === "https" || f.protocol === "http") && /^(mp4|m4a)$/.test(f.ext ?? ""));
    if (chosen && indexed) {
      const files = chosen.formats.map((f) => ({ url: f.url!, headers: f.http_headers ?? {} }));
      const part = await downloadIndexedPart(files, range, dir, { signal: opts.signal, onProgress: (p) => opts.onProgress?.(p) });
      if (part) return part;
    }
    whole = chosen ? wholeFileIsQuicker(chosen, range) : false;
  }
  const args = (from: string[]) => [
    ...ytdlpArgs(),
    "--newline",
    "--no-mtime",
    "--ffmpeg-location",
    ffmpeg,
    ...FORMAT,
    "--merge-output-format",
    "mp4",
    "--progress-template",
    "download:BAMIO %(progress._percent_str)s",
    "-P",
    dir,
    "-o",
    "download.%(ext)s",
    ...(range && !whole ? ["--download-sections", `*${range.start.toFixed(2)}-${range.end.toFixed(2)}`] : []),
    ...from,
  ];

  // Separate video and audio downloads each report 0 to 100%; fold them into one rising number.
  // A part read by ffmpeg reports its position instead ("time=00:01:23.45").
  let phase = 0;
  let last = 0;
  let best = 0;
  const report = (p: number) => {
    best = Math.max(best, Math.min(0.99, p));
    opts.onProgress?.(best);
  };
  const onLine = (line: string) => {
    const p = parseYtdlpProgress(line);
    if (p !== null) {
      if (p < last - 0.3) phase = Math.min(1, phase + 1);
      last = p;
      report(((phase + p) / 2) * (whole ? 0.95 : 1));
      return;
    }
    const time = [...line.matchAll(/time=(\d+):(\d+):([\d.]+)/g)].at(-1);
    if (range && !whole && time) report((Number(time[1]) * 3600 + Number(time[2]) * 60 + Number(time[3])) / Math.max(1, range.end - range.start));
  };
  const download = (from: string[]) => run("yt-dlp", args(from), { signal: opts.signal, onStdoutLine: onLine, onStderrLine: onLine, timeoutMs: 6 * 60 * 60 * 1000 });
  try {
    try {
      await download(source.args);
    } catch (err) {
      // A remembered answer may be stale (links expire): ask the site afresh once.
      if (!source.saved || isAbortError(err)) throw err;
      await download(["--", url]);
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    const tail = err instanceof ProcessError ? err.stderrTail : "";
    console.error("[bamio/media] yt-dlp failed:", tail.slice(-1500));
    throw new HttpError(422, "download_failed", explainYtdlpError(tail, opts.purpose));
  }
  const files = (await readdir(dir)).filter((f) => f.startsWith("download.") && !/\.(part|ytdl|temp)$/i.test(f) && !f.includes(".part-"));
  const file = files.find((f) => f.endsWith(".mp4")) ?? files[0];
  if (!file) throw new HttpError(422, "download_failed", "The download finished without a video file. Try again.");
  if (!range || !whole) return path.join(dir, file);

  // Cut the part out of the whole file: a copy from the keyframe at or before its start.
  const part = path.join(dir, "part.mp4");
  try {
    await run(
      "ffmpeg",
      [
        ...["-hide_banner", "-nostdin", "-y", "-ss", range.start.toFixed(3), "-i", path.join(dir, file), "-t", (range.end - range.start).toFixed(3)],
        ...["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero", part],
      ],
      { signal: opts.signal, timeoutMs: 30 * 60 * 1000 },
    );
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.error("[bamio/media] cutting the part failed:", err instanceof ProcessError ? err.stderrTail.slice(-1500) : err);
    throw new HttpError(422, "download_failed", "Bamio couldn’t cut that part out of the video. Try again.");
  }
  await rm(path.join(dir, file), { force: true });
  return part;
}

/** yt-dlp's choice of formats: H.264/AAC up to 1080p where there is one. */
const FORMAT = ["-f", "bv*+ba/b", "-S", "res:1080,vcodec:h264,acodec:aac"];

type FormatInfo = {
  url?: string;
  ext?: string;
  protocol?: string;
  filesize?: number;
  filesize_approx?: number;
  tbr?: number;
  http_headers?: Record<string, string>;
};

/** The files yt-dlp would download (video and audio, or one), with the video's length. */
async function chosenFormats(from: string[], signal?: AbortSignal): Promise<{ formats: FormatInfo[]; duration: number } | null> {
  try {
    const { stdout } = await run("yt-dlp", [...ytdlpArgs(), ...FORMAT, "-J", "--skip-download", ...from], { signal, timeoutMs: 90_000, collectStdout: 30 * 1024 * 1024 });
    const info = JSON.parse(stdout) as FormatInfo & { duration?: number; requested_formats?: FormatInfo[] };
    return { formats: info.requested_formats ?? [info], duration: Number(info.duration) || 0 };
  } catch (err) {
    if (isAbortError(err)) throw err;
    return null;
  }
}

/**
 * Whether a part is quicker to get by downloading the whole file and cutting it here.
 * yt-dlp fetches a whole file in ranged chunks at full speed (16 to 35 MB/s from YouTube
 * in tests: a 2.8-hour 1080p video in about 1.5 minutes), but a part is read by ffmpeg over
 * one connection, which YouTube throttles to about 2x real time (20 minutes took over 10).
 * Streamed formats (HLS, as on Twitch and Kick) fetch only the part's segments at full speed.
 */
function wholeFileIsQuicker(chosen: { formats: FormatInfo[]; duration: number }, range: { start: number; end: number }): boolean {
  if (!chosen.formats.every((f) => f.protocol === "https" || f.protocol === "http")) return false;
  const bytes = chosen.formats.reduce((sum, f) => sum + (f.filesize ?? f.filesize_approx ?? ((f.tbr ?? 0) * 1000 * chosen.duration) / 8), 0);
  if (!bytes) return false;
  // Conservative speeds: 8 MB/s for a whole file, 1.5x real time for a part.
  return bytes / (8 * 1024 * 1024) < (range.end - range.start) / 1.5;
}

/* ------------------------------ Probe ------------------------------ */

export type Probe = {
  durationSec: number;
  width: number;
  height: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** True when browsers can play the file as-is after a remux to MP4. */
  webSafe: boolean;
};

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  width?: number;
  height?: number;
  duration?: string;
  tags?: { rotate?: string };
  side_data_list?: { rotation?: number }[];
};

export async function probe(file: string, signal?: AbortSignal): Promise<Probe> {
  let stdout: string;
  try {
    ({ stdout } = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], {
      signal,
      timeoutMs: 60_000,
      collectStdout: 4 * 1024 * 1024,
    }));
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new HttpError(422, "unreadable_file", "That file isn’t a video Bamio can read.");
  }
  const data = JSON.parse(stdout) as { streams?: FfprobeStream[]; format?: { duration?: string; format_name?: string } };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video" && s.codec_name !== "mjpeg" && s.codec_name !== "png");
  const audio = streams.find((s) => s.codec_type === "audio");
  const rotation = Math.abs(Number(video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? video?.tags?.rotate ?? 0)) % 180;
  const rawW = video?.width ?? 0;
  const rawH = video?.height ?? 0;
  const durationSec = Number(data.format?.duration ?? video?.duration ?? 0);
  const container = data.format?.format_name ?? "";
  const webSafe =
    Boolean(video) &&
    video?.codec_name === "h264" &&
    (video.pix_fmt === "yuv420p" || video.pix_fmt === "yuvj420p") &&
    !/high 10|4:2:2|4:4:4/i.test(video.profile ?? "") &&
    rotation === 0 &&
    Math.max(rawW, rawH) <= 3840 &&
    (!audio || audio.codec_name === "aac") &&
    // Recorded live streams are MPEG-TS, and followed ones HLS of fMP4 segments: H.264/AAC in
    // either copies into MP4 without re-encoding.
    /mp4|mov|mpegts|hls/.test(container);
  return {
    durationSec: Number.isFinite(durationSec) ? durationSec : 0,
    width: rotation === 90 ? rawH : rawW,
    height: rotation === 90 ? rawW : rawH,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    webSafe,
  };
}

/* ------------------------------ Prepare ------------------------------ */

function ffmpegProgress(durationSec: number, onProgress?: (p: number) => void) {
  return (line: string) => {
    const t = parseFfmpegProgress(line);
    if (t !== null && durationSec > 0) onProgress?.(Math.min(0.99, t / durationSec));
  };
}

/**
 * Make a browser-playable MP4 with its index at the front (so seeking works while
 * streaming). Remuxes when the codecs already fit, otherwise re-encodes to H.264/AAC.
 * `live`: a recorded live stream, whose audio is re-timed (see below).
 */
export async function prepareSource(
  input: string,
  output: string,
  info: Probe,
  opts: { live?: boolean; signal?: AbortSignal; onProgress?: (p: number) => void },
) {
  const tmp = `${output}.part.mp4`;
  const common = ["-hide_banner", "-nostdin", "-y", "-i", input, "-map", "0:v:0", ...(info.hasAudio ? ["-map", "0:a:0"] : [])];
  // A live recording's audio can repeat or skip a moment where the stream's segments join,
  // and can start after the picture. Copied as is, the sound after a repeat plays late, so
  // it is re-encoded against its timestamps (repeats dropped, gaps and the start filled with silence).
  const audio = info.hasAudio ? [...(opts.live ? ["-af", "aresample=async=1:first_pts=0"] : []), "-c:a", "aac", "-b:a", "160k", "-ac", "2"] : [];
  const encode = info.webSafe
    ? opts.live
      ? ["-c:v", "copy", ...audio]
      : ["-c", "copy"]
    : [
        "-vf",
        "scale='min(iw,1920)':'min(ih,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        ...audio,
      ];
  try {
    await run("ffmpeg", [...common, ...encode, "-movflags", "+faststart", "-progress", "pipe:1", "-nostats", tmp], {
      signal: opts.signal,
      onStdoutLine: ffmpegProgress(info.durationSec, opts.onProgress),
    });
  } catch (err) {
    await rm(tmp, { force: true });
    if (isAbortError(err)) throw err;
    console.error("[bamio/media] prepare failed:", err instanceof ProcessError ? err.stderrTail.slice(-1500) : err);
    throw new HttpError(422, "prepare_failed", "Bamio couldn’t convert that video. Try a different file.");
  }
  await replaceFile(tmp, output);
}

/** A JPEG frame at `atSec`, scaled to `width`. */
export async function extractFrame(input: string, output: string, atSec: number, width = 640, signal?: AbortSignal) {
  const tmp = `${output}.part.jpg`;
  try {
    await run(
      "ffmpeg",
      ["-hide_banner", "-nostdin", "-y", "-ss", Math.max(0, atSec).toFixed(2), "-i", input, "-frames:v", "1", "-update", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", tmp],
      { signal, timeoutMs: 30_000 },
    );
    await replaceFile(tmp, output);
  } catch (err) {
    // The project was deleted while its frame was being drawn.
    if (!(await stat(path.dirname(output)).catch(() => null))) throw new HttpError(404, "not_found", "That project was deleted.");
    throw err;
  } finally {
    await rm(tmp, { force: true });
  }
}

/** Mono 16 kHz MP3 pieces for transcription. Returns the files with their start offsets. */
export async function extractAudioChunks(input: string, dir: string, chunkSec: number, signal?: AbortSignal) {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await run(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostdin",
      "-y",
      "-i",
      input,
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      // Sample 0 is the video's time 0, and gaps in the audio stay gaps, so times match the video.
      "-af",
      "aresample=async=1:first_pts=0",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "32k",
      "-f",
      "segment",
      "-segment_time",
      String(chunkSec),
      "-reset_timestamps",
      "1",
      path.join(dir, "chunk-%03d.mp3"),
    ],
    { signal, timeoutMs: 60 * 60 * 1000 },
  );
  const files = (await readdir(dir)).filter((f) => /^chunk-\d{3}\.mp3$/.test(f)).sort();
  return files.map((f, i) => ({ file: path.join(dir, f), offset: i * chunkSec }));
}

/* ------------------------------ Export ------------------------------ */

const FONT_FILE = "BricolageGrotesque-ExtraBold.ttf";

/**
 * Render one clip. The work dir gets subs.ass and a fonts/ folder (Bricolage plus `fonts`,
 * the files for any other scripts in the captions); ffmpeg runs inside it so the
 * subtitles filter sees plain relative paths (no drive-letter escaping).
 */
export async function renderClip(
  plan: Omit<RenderPlan, "subtitles" | "output"> & { output: string; ass: string | null; fonts?: string[]; workDir: string },
  opts: { signal?: AbortSignal; onProgress?: (p: number) => void },
) {
  await rm(plan.workDir, { recursive: true, force: true });
  await mkdir(path.join(plan.workDir, "fonts"), { recursive: true });
  await mkdir(path.dirname(plan.output), { recursive: true });
  const tmp = `${plan.output}.part.mp4`;
  try {
    if (plan.ass) {
      await writeFile(path.join(plan.workDir, "subs.ass"), plan.ass, "utf8");
      await copyFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "assets", "fonts", FONT_FILE), path.join(plan.workDir, "fonts", FONT_FILE));
      for (const font of plan.fonts ?? []) await copyFile(font, path.join(plan.workDir, "fonts", path.basename(font)));
    }
    const args = renderArgs({ ...plan, output: tmp, subtitles: Boolean(plan.ass) });
    await run("ffmpeg", args, { cwd: plan.workDir, signal: opts.signal, onStdoutLine: ffmpegProgress(plan.duration, opts.onProgress) });
    // ffmpeg can finish "successfully" having read nothing (a source it couldn't seek in): never
    // hand that out as a download.
    const made = await probe(tmp, opts.signal).catch(() => null);
    if (!made?.hasVideo || made.durationSec < Math.min(1, plan.duration * 0.5)) {
      console.error(`[bamio/media] render came out empty (${made ? `${made.durationSec.toFixed(2)} s` : "unreadable"} of ${plan.duration.toFixed(2)} s) from ${path.basename(plan.input)}`);
      throw new HttpError(500, "render_empty", `The export came out empty. Try again; if it keeps happening, write to ${CONTACT_EMAIL} and say which video.`);
    }
    await replaceFile(tmp, plan.output);
    return (await stat(plan.output)).size;
  } catch (err) {
    await rm(tmp, { force: true });
    if (isAbortError(err) || err instanceof HttpError) throw err;
    console.error("[bamio/media] render failed:", err instanceof ProcessError ? err.stderrTail.slice(-2000) : err);
    throw new HttpError(500, "render_failed", "The export failed. Try again; if it keeps failing, try the Fit framing.");
  } finally {
    await rm(plan.workDir, { recursive: true, force: true });
  }
}
