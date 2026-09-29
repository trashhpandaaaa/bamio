import "server-only";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { formatTimecode } from "@/lib/clips/logic";
import { LIVE_WINDOW_SEC, vodRange } from "@/lib/clips/live";
import { parseFfmpegProgress } from "@/lib/clips/progress";
import { LIMITS, type InspectResult, type Platform, type Source } from "@/lib/clips/schema";
import { isAbortError, ProcessError, run } from "@/lib/server/bin";
import { measureChoices, type Format } from "@/lib/server/hls";
import { HttpError } from "@/lib/server/http";
import { downloadUrl, explainYtdlpError, inspectCached, ytdlpArgs } from "@/lib/server/media";

/*
 * Capturing live streams (YouTube, Twitch, Kick and other HLS live sources).
 *
 * - Twitch with past broadcasts on: the stream has an in-progress VOD, so a capture can
 *   start anywhere since the stream began. Bamio waits while "recording", then downloads
 *   that part of the VOD.
 * - Everything else: ffmpeg records the live HLS playlist. How far back it can start
 *   depends on how much history the playlist keeps (YouTube DVR streams: often an hour;
 *   Twitch and Kick live playlists: about 30 s, which is always included). The recording
 *   is MPEG-TS, so it is usable even if cut short, and it can be stopped early.
 */

/** Shortest playlist history worth offering as "go back". Shorter ones are just included. */
const MIN_REWIND_SEC = 60;

type LiveJson = { extractor_key?: string; duration?: number; webpage_url?: string; formats?: Format[]; is_live?: boolean };

async function ytdlpJson(url: string, extra: string[], signal?: AbortSignal): Promise<LiveJson> {
  try {
    const { stdout } = await run("yt-dlp", [...ytdlpArgs(), ...extra, "-J", "--skip-download", "--", url], { signal, timeoutMs: 90_000, collectStdout: 30 * 1024 * 1024 });
    return JSON.parse(stdout) as LiveJson;
  } catch (err) {
    if (isAbortError(err)) throw err;
    const tail = err instanceof ProcessError ? err.stderrTail : "";
    throw new HttpError(422, "unreadable", explainYtdlpError(tail));
  }
}

export type LiveDetails = { canRewind: boolean; rewindSec: number; vod?: { url: string; durationSec: number } };

/** How far back a live stream can be captured, and (Twitch) its in-progress VOD. */
export async function liveInfo(url: string, platform: Platform, signal?: AbortSignal): Promise<LiveDetails> {
  if (platform === "twitch") {
    try {
      const vod = await ytdlpJson(url, ["--live-from-start"], signal);
      const duration = Number(vod.duration);
      if (vod.extractor_key === "TwitchVod" && vod.webpage_url && Number.isFinite(duration) && duration > 0) {
        return { canRewind: true, rewindSec: Math.floor(Math.min(duration, LIMITS.maxMediaSec)), vod: { url: vod.webpage_url, durationSec: duration } };
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      // No VOD (past broadcasts off): use the live playlist like any other stream.
    }
  }
  const info = await ytdlpJson(url, [], signal);
  const choices = await measureChoices(info.formats ?? [], UNKNOWN_WINDOW, signal);
  const usable = Math.max(0, ...choices.map(usableRewind));
  if (usable >= MIN_REWIND_SEC) return { canRewind: true, rewindSec: Math.min(usable, LIMITS.maxMediaSec) };
  return { canRewind: false, rewindSec: LIVE_WINDOW_SEC };
}

/** What a playlist that can't be read is taken to hold (a typical short live playlist). */
const UNKNOWN_WINDOW = { windowSec: LIVE_WINDOW_SEC, segmentSec: 5 };

type Window = { windowSec: number; segmentSec: number };

/** How far back a playlist can be started, leaving a few segments of margin: the oldest ones roll off while the capture starts. */
export const usableRewind = (w: Window) => Math.floor(w.windowSec - 3 * w.segmentSec);

/**
 * Which way to record a stream: from now, the simplest; going back, the simplest whose
 * history reaches far enough, else the one reaching furthest.
 */
export function chooseRecording<T extends Window>(choices: T[], rewindSec: number): T | undefined {
  if (rewindSec <= 0) return choices[0];
  return choices.find((c) => usableRewind(c) >= rewindSec) ?? choices.toSorted((a, b) => usableRewind(b) - usableRewind(a))[0];
}

/** ffmpeg/ffprobe options for an HLS input's HTTP headers. */
function headerArgs(f: Format): string[] {
  const headers = { ...(f.http_headers ?? {}) };
  const ua = headers["User-Agent"];
  delete headers["User-Agent"];
  const rest = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}\r\n`)
    .join("");
  return [...(ua ? ["-user_agent", ua] : []), ...(rest ? ["-headers", rest] : [])];
}

/** Whether an HLS playlist carries audio (YouTube's "video" playlists usually do). */
async function hasAudio(f: Format, signal: AbortSignal): Promise<boolean> {
  try {
    const { stdout } = await run("ffprobe", ["-v", "error", ...headerArgs(f), "-show_entries", "stream=codec_type", "-of", "csv=p=0", "-i", f.url!], {
      signal,
      timeoutMs: 45_000,
      collectStdout: 64 * 1024,
    });
    return /audio/.test(stdout);
  } catch (err) {
    if (isAbortError(err)) throw err;
    return false;
  }
}

/**
 * ffmpeg input options for an HLS input, starting `startIndex` segments into the playlist
 * (negative: from its end) and reading `seconds` of it. The length is set per input because
 * ffmpeg counts an input's -t from that input's start, even with -copyts.
 */
const inputArgs = (f: Format, startIndex: number, seconds: number) => [
  ...headerArgs(f),
  "-live_start_index",
  String(startIndex),
  "-rw_timeout",
  "20000000",
  "-t",
  String(seconds),
  "-i",
  f.url!,
];

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      },
      { once: true },
    );
  });

export type LiveProgress = (value: number, message: string) => void;

/**
 * Where to start in a live playlist and how much media that gives before "now", for a
 * capture going `rewindSec` back (0: from now).
 */
export function playlistStart(rewindSec: number, windowSec: number, segmentSec: number): { startIndex: number; backlog: number } {
  if (rewindSec > 0) {
    const segments = Math.ceil(rewindSec / segmentSec) + 1;
    return segments * segmentSec < windowSec ? { startIndex: -segments, backlog: segments * segmentSec } : { startIndex: 0, backlog: windowSec };
  }
  // A long (DVR) playlist: start at the live edge, don't pull its whole history.
  if (usableRewind({ windowSec, segmentSec }) >= MIN_REWIND_SEC) return { startIndex: -3, backlog: 3 * segmentSec };
  // A short playlist: include the few seconds it keeps.
  return { startIndex: 0, backlog: windowSec };
}

/**
 * Capture a live stream into `dir`. `stopSignal` ends the recording early (what was
 * captured so far is kept); `signal` cancels everything. Returns the recorded file.
 */
export async function recordLive(
  source: Source,
  dir: string,
  opts: { signal: AbortSignal; stopSignal: AbortSignal; onProgress: LiveProgress },
): Promise<{ file: string; vodRange?: { start: number; end: number } }> {
  const live = source.live;
  if (!live || !source.url) throw new HttpError(400, "not_live", "This project wasn’t captured from a live stream.");
  const total = live.rewindSec + live.recordSec;

  // Twitch with a VOD: wait out the "from now" part, then download that stretch of the VOD.
  if (live.vodUrl && live.vodDurationSec !== undefined) {
    let range = live.vodRange;
    if (!range) {
      const until = live.requestedAt + live.recordSec * 1000;
      while (Date.now() < until && !opts.stopSignal.aborted) {
        const elapsed = (Date.now() - live.requestedAt) / 1000;
        opts.onProgress((live.rewindSec + elapsed) / Math.max(1, total), `Recording live: ${formatTimecode(elapsed)} of ${formatTimecode(live.recordSec)}`);
        await sleep(1000, opts.signal);
      }
      const stoppedAt = Math.min(Date.now(), until);
      // Twitch writes the VOD a little behind the live picture.
      if (stoppedAt > live.requestedAt + 1000) {
        opts.onProgress(0.99, "Waiting for the stream to catch up");
        await sleep(20_000, opts.signal);
      }
      range = vodRange({ ...live, vodDurationSec: live.vodDurationSec }, stoppedAt);
    }
    const span = formatTimecode(range.end - range.start);
    opts.onProgress(0, `Downloading the captured ${span}`);
    const file = await downloadUrl(live.vodUrl, dir, {
      range,
      precise: false,
      // The VOD is still growing while the stream is live; without this yt-dlp would wait at its live end.
      extraArgs: ["--live-from-start"],
      signal: opts.signal,
      onProgress: (p) => opts.onProgress(p ?? 0, `Downloading the captured ${span}`),
    });
    return { file, vodRange: range };
  }

  // Everything else: record the live playlist with ffmpeg.
  const info = await ytdlpJson(source.url, [], opts.signal);
  if (info.is_live === false) throw new HttpError(422, "not_live", "The stream has ended. Import its replay (VOD) instead.");
  const recording = chooseRecording(await measureChoices(info.formats ?? [], UNKNOWN_WINDOW, opts.signal), live.rewindSec);
  if (!recording) throw new HttpError(422, "no_stream", "Bamio couldn’t find a recordable stream at that link.");
  let inputs = recording.inputs;
  // One input when the video playlist has sound; two live inputs need their clocks lined up.
  if (inputs.length === 2 && (await hasAudio(inputs[0]!, opts.signal))) inputs = [inputs[0]!];
  const { startIndex, backlog } = playlistStart(live.rewindSec, recording.windowSec, recording.segmentSec);
  const target = Math.ceil(backlog + live.recordSec);
  const single = inputs.length === 1;
  const out = path.join(dir, "recording.ts");
  const args = [
    "-hide_banner",
    "-y",
    ...inputs.flatMap((f) => inputArgs(f, startIndex, target)),
    ...(single
      ? ["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy"]
      : [
          // Two inputs keep their original timestamps so audio and video stay in step: their
          // playlists may start a segment apart.
          "-copyts",
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "copy",
          // YouTube's audio playlists can repeat a second or two where segments join. Copied,
          // the repeat would push the rest of the sound late; re-timed, it is dropped.
          "-af",
          "aresample=async=1",
          "-c:a",
          "aac",
          "-b:a",
          "160k",
        ]),
    "-f",
    "mpegts",
    "-progress",
    "pipe:1",
    "-nostats",
    out,
  ];
  await mkdir(dir, { recursive: true });

  // Stop cleanly ("q") when the user presses Stop, or as a safety net if the stream stalls.
  const finish = new AbortController();
  const endNow = () => finish.abort();
  opts.stopSignal.addEventListener("abort", endNow, { once: true });
  const timer = setTimeout(endNow, (target + 120) * 1000);
  let log = "";
  try {
    ({ stderrTail: log } = await run("ffmpeg", args, {
      signal: opts.signal,
      stopSignal: finish.signal,
      timeoutMs: (target + 300) * 1000,
      // ffmpeg reports time from the recording's start, with or without -copyts.
      onStdoutLine: (line) => {
        const t = parseFfmpegProgress(line);
        if (t !== null) opts.onProgress(Math.min(0.99, t / Math.max(1, target)), `Recording live: ${formatTimecode(t)} of ${formatTimecode(target)}`);
      },
    }));
  } catch (err) {
    if (isAbortError(err)) throw err;
    // A dropped stream still leaves a usable recording; only fail if there's nothing.
    const size = await stat(out).then((s) => s.size).catch(() => 0);
    if (size < 64 * 1024) {
      console.error("[bamio/live] recording failed:", err instanceof ProcessError ? err.stderrTail.slice(-1500) : err);
      throw new HttpError(422, "record_failed", "Bamio couldn’t record that stream. It may have ended or be restricted.");
    }
  } finally {
    clearTimeout(timer);
    opts.stopSignal.removeEventListener("abort", endNow);
  }
  const size = await stat(out).then((s) => s.size).catch(() => 0);
  if (size < 64 * 1024) {
    console.error(`[bamio/live] recording is empty (${size} bytes):`, log.slice(-2000));
    throw new HttpError(422, "record_failed", "Nothing was recorded. The stream may have ended.");
  }
  return { file: out };
}

type CachedLive = { at: number; result: Promise<InspectResult> };
const liveCache: Map<string, CachedLive> = ((globalThis as { __bamioLiveInspect?: Map<string, CachedLive> }).__bamioLiveInspect ??= new Map());

/**
 * Look up a link for the import form: title, length, thumbnail, and for live streams how
 * far back they can be captured. Live details are remembered for a minute only.
 */
export async function inspectLink(input: string): Promise<InspectResult> {
  const info = await inspectCached(input);
  if (!info.live) return info;
  const key = info.url;
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.result;
  const result = liveInfo(info.url, info.platform).then((live) => ({
    ...info,
    live: { ...info.live!, canRewind: live.canRewind, rewindSec: Math.round(live.rewindSec) },
  }));
  liveCache.set(key, { at: Date.now(), result });
  result.catch(() => liveCache.delete(key));
  return result;
}
