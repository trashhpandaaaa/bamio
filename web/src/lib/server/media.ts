import "server-only";
import { lookup } from "node:dns/promises";
import { copyFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { isIP } from "node:net";
import path from "node:path";
import { parseFfmpegProgress, parseYtdlpProgress } from "@/lib/clips/progress";
import { renderArgs, type RenderPlan } from "@/lib/clips/render";
import { detectPlatform, isPrivateAddress, parseVideoUrl } from "@/lib/clips/url";
import { LIMITS, type InspectResult } from "@/lib/clips/schema";
import { binPath, isAbortError, ProcessError, run } from "@/lib/server/bin";
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

const ytdlpBase = () => ["--no-playlist", "--no-warnings", "--ignore-config", "--js-runtimes", `node:${process.execPath}`];

/** Turn yt-dlp's stderr into a message the user can act on. */
export function explainYtdlpError(stderr: string): string {
  const s = stderr.toLowerCase();
  if (s.includes("unsupported url")) return "Bamio can’t read videos from that page. Try the video’s own page, or upload the file.";
  if (s.includes("not a bot")) return "The site asked for a sign-in to prove this isn’t a bot. Try again later, or download the video and upload it.";
  if (s.includes("private video") || s.includes("members-only") || s.includes("subscriber") || s.includes("login") || s.includes("sign in")) {
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
  if (s.includes("timed out") || s.includes("connection") || s.includes("network")) return "The site didn’t answer. Check your connection and try again.";
  return "Bamio couldn’t read that link. Check it opens in your browser, or upload the file instead.";
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
};

/** Read a link's title, length and thumbnail without downloading it. */
export async function inspectUrl(input: string, signal?: AbortSignal): Promise<InspectResult> {
  const url = await checkPublicUrl(input);
  requireYtdlp();
  let stdout: string;
  try {
    ({ stdout } = await run("yt-dlp", [...ytdlpBase(), "-J", "--skip-download", "--", url.href], {
      signal,
      timeoutMs: 60_000,
      collectStdout: 30 * 1024 * 1024,
    }));
  } catch (err) {
    if (isAbortError(err)) throw err;
    const tail = err instanceof ProcessError ? err.stderrTail : "";
    throw new HttpError(422, "unreadable", explainYtdlpError(tail));
  }
  let info: YtdlpInfo;
  try {
    info = JSON.parse(stdout) as YtdlpInfo;
  } catch {
    throw new HttpError(422, "unreadable", "Bamio couldn’t read that link. Try the video’s own page.");
  }
  if (info._type === "playlist" || info._type === "multi_video") {
    throw new HttpError(422, "playlist", "That’s a playlist. Paste the link to one video.");
  }
  if (info.is_live || info.live_status === "is_live" || info.live_status === "post_live") {
    throw new HttpError(422, "live", "That stream is still live. Clip it once the replay (VOD) is ready.");
  }
  if (info.live_status === "is_upcoming") throw new HttpError(422, "upcoming", "That video hasn’t started yet.");
  const durationSec = Number(info.duration);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new HttpError(422, "no_duration", "Bamio couldn’t tell how long that video is, so it can’t be imported.");
  }
  const title = (info.title ?? info.fulltitle ?? "").trim() || "Untitled video";
  const thumb = info.thumbnail && /^https:\/\//.test(info.thumbnail) ? info.thumbnail : undefined;
  const page = info.webpage_url && /^https?:\/\//.test(info.webpage_url) ? info.webpage_url : url.href;
  return {
    url: page,
    platform: detectPlatform(new URL(page)),
    title: title.slice(0, LIMITS.title),
    uploader: (info.channel ?? info.uploader)?.slice(0, 200),
    durationSec,
    thumbnail: thumb,
  };
}

type CachedInspect = { at: number; result: Promise<InspectResult> };
const inspectCache: Map<string, CachedInspect> = ((globalThis as { __bamioInspect?: Map<string, CachedInspect> }).__bamioInspect ??= new Map());

/** inspectUrl, remembered for 10 minutes so the import step doesn't ask the site twice. */
export function inspectCached(input: string): Promise<InspectResult> {
  const key = input.trim();
  const now = Date.now();
  const hit = inspectCache.get(key);
  if (hit && now - hit.at < 10 * 60 * 1000) return hit.result;
  const result = inspectUrl(key);
  inspectCache.set(key, { at: now, result });
  result.catch(() => inspectCache.delete(key));
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
  opts: { range?: { start: number; end: number }; signal?: AbortSignal; onProgress?: (p: number | null) => void },
): Promise<string> {
  await checkPublicUrl(url);
  requireYtdlp();
  const ffmpeg = binPath("ffmpeg");
  if (!ffmpeg) throw new HttpError(503, "no_ffmpeg", "ffmpeg is missing. Reinstall the app’s packages (npm install).");
  await mkdir(dir, { recursive: true });

  const args = [
    ...ytdlpBase(),
    "--newline",
    "--no-mtime",
    "--ffmpeg-location",
    ffmpeg,
    "-f",
    "bv*+ba/b",
    "-S",
    "res:1080,vcodec:h264,acodec:aac",
    "--merge-output-format",
    "mp4",
    "--progress-template",
    "download:BAMIO %(progress._percent_str)s",
    "-P",
    dir,
    "-o",
    "download.%(ext)s",
  ];
  if (opts.range) args.push("--download-sections", `*${opts.range.start.toFixed(2)}-${opts.range.end.toFixed(2)}`, "--force-keyframes-at-cuts");
  args.push("--", url);

  // Separate video and audio downloads each report 0 to 100%; fold them into one rising number.
  let phase = 0;
  let last = 0;
  let best = 0;
  const onLine = (line: string) => {
    const p = parseYtdlpProgress(line);
    if (p === null) return;
    if (p < last - 0.3) phase = Math.min(1, phase + 1);
    last = p;
    best = Math.max(best, Math.min(0.99, (phase + p) / 2));
    opts.onProgress?.(best);
  };
  try {
    await run("yt-dlp", args, { signal: opts.signal, onStdoutLine: onLine, onStderrLine: onLine, timeoutMs: 6 * 60 * 60 * 1000 });
  } catch (err) {
    if (isAbortError(err)) throw err;
    const tail = err instanceof ProcessError ? err.stderrTail : "";
    console.error("[bamio/media] yt-dlp failed:", tail.slice(-1500));
    throw new HttpError(422, "download_failed", explainYtdlpError(tail));
  }
  const files = (await readdir(dir)).filter((f) => f.startsWith("download.") && !/\.(part|ytdl|temp)$/i.test(f) && !f.includes(".part-"));
  const file = files.find((f) => f.endsWith(".mp4")) ?? files[0];
  if (!file) throw new HttpError(422, "download_failed", "The download finished without a video file. Try again.");
  return path.join(dir, file);
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
    /mp4|mov/.test(container);
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
 */
export async function prepareSource(input: string, output: string, info: Probe, opts: { signal?: AbortSignal; onProgress?: (p: number) => void }) {
  const tmp = `${output}.part.mp4`;
  const common = ["-hide_banner", "-nostdin", "-y", "-i", input, "-map", "0:v:0", ...(info.hasAudio ? ["-map", "0:a:0"] : [])];
  const encode = info.webSafe
    ? ["-c", "copy"]
    : [
        "-vf",
        "scale='min(iw,1920)':'min(ih,1920)':force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        ...(info.hasAudio ? ["-c:a", "aac", "-b:a", "160k", "-ac", "2"] : []),
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
      ["-hide_banner", "-nostdin", "-y", "-ss", Math.max(0, atSec).toFixed(2), "-i", input, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", tmp],
      { signal, timeoutMs: 30_000 },
    );
    await replaceFile(tmp, output);
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
 * Render one clip. The work dir gets subs.ass and a fonts/ folder; ffmpeg runs inside
 * it so the subtitles filter sees plain relative paths (no drive-letter escaping).
 */
export async function renderClip(
  plan: Omit<RenderPlan, "subtitles" | "output"> & { output: string; ass: string | null; workDir: string },
  opts: { signal?: AbortSignal; onProgress?: (p: number) => void },
) {
  await rm(plan.workDir, { recursive: true, force: true });
  await mkdir(path.join(plan.workDir, "fonts"), { recursive: true });
  await mkdir(path.dirname(plan.output), { recursive: true });
  const tmp = `${plan.output}.part.mp4`;
  try {
    if (plan.ass) {
      await writeFile(path.join(plan.workDir, "subs.ass"), plan.ass, "utf8");
      await copyFile(path.join(process.cwd(), "assets", "fonts", FONT_FILE), path.join(plan.workDir, "fonts", FONT_FILE));
    }
    const args = renderArgs({ ...plan, output: tmp, subtitles: Boolean(plan.ass) });
    await run("ffmpeg", args, { cwd: plan.workDir, signal: opts.signal, onStdoutLine: ffmpegProgress(plan.duration, opts.onProgress) });
    await replaceFile(tmp, plan.output);
    return (await stat(plan.output)).size;
  } catch (err) {
    await rm(tmp, { force: true });
    if (isAbortError(err)) throw err;
    console.error("[bamio/media] render failed:", err instanceof ProcessError ? err.stderrTail.slice(-2000) : err);
    throw new HttpError(500, "render_failed", "The export failed. Try again; if it keeps failing, try the Fit framing.");
  } finally {
    await rm(plan.workDir, { recursive: true, force: true });
  }
}
