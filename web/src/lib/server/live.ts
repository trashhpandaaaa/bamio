import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatTimecode } from "@/lib/clips/logic";
import { LIVE_WINDOW_SEC, vodRange } from "@/lib/clips/live";
import { parseFfmpegProgress } from "@/lib/clips/progress";
import { LIMITS, type InspectResult, type Platform, type Source } from "@/lib/clips/schema";
import { isAbortError, ProcessError, run } from "@/lib/server/bin";
import { inputChoices, measureChoices, parsePlaylistWindow, playlistText, playlistWindow, segmentAt, type Format } from "@/lib/server/hls";
import { HttpError } from "@/lib/server/http";
import { explainYtdlpError, inspectCached, ytdlpArgs } from "@/lib/server/media";

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

/**
 * How far back a live stream can be captured: `rewindSec` for capturing a part (at most
 * 3 hours), `availableSec` all the history the site keeps (a Twitch VOD: the whole stream),
 * and (Twitch) its in-progress VOD.
 */
export type LiveDetails = { canRewind: boolean; rewindSec: number; availableSec: number; vod?: { url: string; durationSec: number } };

export async function liveInfo(url: string, platform: Platform, signal?: AbortSignal): Promise<LiveDetails> {
  if (platform === "twitch") {
    try {
      const vod = await ytdlpJson(url, ["--live-from-start"], signal);
      const duration = Number(vod.duration);
      if (vod.extractor_key === "TwitchVod" && vod.webpage_url && Number.isFinite(duration) && duration > 0) {
        return {
          canRewind: true,
          rewindSec: Math.floor(Math.min(duration, LIMITS.maxMediaSec)),
          availableSec: Math.floor(duration),
          vod: { url: vod.webpage_url, durationSec: duration },
        };
      }
    } catch (err) {
      if (isAbortError(err)) throw err;
      // No VOD (past broadcasts off): use the live playlist like any other stream.
    }
  }
  const info = await ytdlpJson(url, [], signal);
  const choices = await measureChoices(info.formats ?? [], UNKNOWN_WINDOW, signal);
  const usable = Math.max(0, ...choices.map(usableRewind));
  if (usable >= MIN_REWIND_SEC) return { canRewind: true, rewindSec: Math.min(usable, LIMITS.maxMediaSec), availableSec: usable };
  return { canRewind: false, rewindSec: LIVE_WINDOW_SEC, availableSec: LIVE_WINDOW_SEC };
}

/** How far back following may start (BAMIO_FOLLOW_MAX_BACK_SEC overrides the 6 hours, e.g. for tests). */
export const followMaxBackSec = () => Number(process.env.BAMIO_FOLLOW_MAX_BACK_SEC) || LIMITS.maxFollowBackSec;

/**
 * Where following a stream would start: as far back as the site keeps, up to the limit,
 * and whether that reaches the stream's start (`startedAt`, ms, when the site says).
 */
export function followStart(live: Pick<LiveDetails, "availableSec" | "vod">, startedAt: number | undefined, now = Date.now()): { backSec: number; fromStart: boolean } {
  const backSec = Math.floor(Math.min(live.availableSec, followMaxBackSec()));
  const elapsed = live.vod ? live.vod.durationSec : startedAt ? (now - startedAt) / 1000 : Infinity;
  return { backSec, fromStart: elapsed <= backSec + 60 };
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

/** Wait `ms`, or reject with an AbortError when `signal` fires. */
export const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(t);
      reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
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
    return { file: await downloadVodRange(live.vodUrl, range, dir, opts, span), vodRange: range };
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

/**
 * A stretch of a Twitch VOD (seconds from its start), read straight from its playlist
 * with ffmpeg from the segment that holds `range.start`. (yt-dlp's section download of a
 * VOD that is still growing reads it from the beginning: minutes on a long stream.) An
 * in-progress VOD is a live playlist, started by segment index; a finished one is seeked.
 */
async function downloadVodRange(vodUrl: string, range: { start: number; end: number }, dir: string, opts: { signal: AbortSignal; onProgress: LiveProgress }, span: string) {
  const vod = await ytdlpJson(vodUrl, ["--live-from-start"], opts.signal);
  const input = inputChoices(vod.formats ?? [])[0]?.[0];
  if (!input?.url) throw new HttpError(422, "no_stream", "Bamio couldn’t find the stream’s broadcast (VOD).");
  const text = await playlistText(input, opts.signal);
  const seg = segmentAt(text, range.start);
  const finished = text.includes("#EXT-X-ENDLIST");
  const length = range.end - (finished ? range.start : seg.start);
  const out = path.join(dir, "vod.ts");
  await mkdir(dir, { recursive: true });
  const start = finished ? ["-ss", range.start.toFixed(2)] : ["-live_start_index", String(seg.index)];
  const args = [
    ...["-hide_banner", "-y", ...headerArgs(input), ...start, "-rw_timeout", "20000000", "-t", length.toFixed(2), "-i", input.url],
    ...["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-f", "mpegts", "-progress", "pipe:1", "-nostats", out],
  ];
  try {
    await run("ffmpeg", args, {
      signal: opts.signal,
      timeoutMs: (length + 600) * 1000,
      onStdoutLine: (line) => {
        const t = parseFfmpegProgress(line);
        if (t !== null) opts.onProgress(Math.min(0.99, t / Math.max(1, length)), `Downloading the captured ${span}`);
      },
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.error("[bamio/live] VOD download failed:", err instanceof ProcessError ? err.stderrTail.slice(-1500) : err);
    throw new HttpError(422, "record_failed", "Bamio couldn’t download that part of the stream. Try again.");
  }
  const size = await stat(out).then((s) => s.size).catch(() => 0);
  if (size < 64 * 1024) throw new HttpError(422, "record_failed", "Nothing was captured. The stream may have ended.");
  return out;
}

/* ------------------------------ Following ------------------------------ */

export type FollowEnd = "stopped" | "ended" | "limit" | "error";

/**
 * The live dir's files: the growing playlist and its 6 s MPEG-TS segments. (Streams followed
 * before 2026-10-03 used fMP4: init.mp4 and .m4s segments, still served. ffmpeg can't seek in
 * an fMP4 playlist: past the first segment it reads nothing, so exports and frames came out
 * empty. In MPEG-TS it seeks like in any file.)
 */
export const LIVE_PLAYLIST = "source.m3u8";
export const LIVE_FILE = /^(source\.m3u8|seg-\d{6}\.ts|init\.mp4|seg-\d{6}\.m4s)$/;
/** A media segment's name in the live playlist. */
export const LIVE_SEGMENT = /^seg-\d{6}\.(ts|m4s)$/;

/**
 * Follow a live stream into `dir` as HLS (MPEG-TS segments and a growing EVENT playlist that
 * the editor plays while it grows): from `backSec` before now (a Twitch VOD: from its
 * start), until the stream ends, `stopSignal` fires (the playlist is closed cleanly), or
 * 12 hours are captured. Resolves with why it ended.
 */
export async function followLive(source: Source, dir: string, opts: { backSec: number; signal: AbortSignal; stopSignal: AbortSignal }): Promise<FollowEnd> {
  const live = source.live;
  if (!live || !source.url) throw new HttpError(400, "not_live", "This project wasn’t captured from a live stream.");
  let inputs: Format[];
  let startIndex: number;
  if (live.vodUrl) {
    // Twitch: the in-progress VOD is a growing playlist of the whole stream.
    const vod = await ytdlpJson(live.vodUrl, ["--live-from-start"], opts.signal);
    const choice = inputChoices(vod.formats ?? [])[0];
    if (!choice) throw new HttpError(422, "no_stream", "Bamio couldn’t find a recordable stream at that link.");
    inputs = choice;
    const { windowSec, segmentSec } = await playlistWindow(choice[0]!, opts.signal).catch(() => ({ windowSec: 0, segmentSec: 10 }));
    startIndex = opts.backSec >= windowSec - segmentSec ? 0 : -Math.ceil(opts.backSec / segmentSec);
  } else {
    const info = await ytdlpJson(source.url, [], opts.signal);
    if (info.is_live === false) throw new HttpError(422, "not_live", "The stream has ended. Import its replay (VOD) instead.");
    const recording = chooseRecording(await measureChoices(info.formats ?? [], UNKNOWN_WINDOW, opts.signal), opts.backSec);
    if (!recording) throw new HttpError(422, "no_stream", "Bamio couldn’t find a recordable stream at that link.");
    inputs = recording.inputs;
    ({ startIndex } = playlistStart(opts.backSec, recording.windowSec, recording.segmentSec));
  }
  if (inputs.length === 2 && (await hasAudio(inputs[0]!, opts.signal))) inputs = [inputs[0]!];
  const single = inputs.length === 1;
  const limit = LIMITS.maxFollowSec;
  const args = [
    "-hide_banner",
    "-y",
    ...inputs.flatMap((f) => inputArgs(f, startIndex, limit)),
    ...(single
      ? ["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy"]
      : ["-copyts", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", "aresample=async=1", "-c:a", "aac", "-b:a", "160k"]),
    ...["-f", "hls", "-hls_time", "6", "-hls_list_size", "0", "-hls_playlist_type", "event", "-hls_segment_type", "mpegts"],
    ...["-hls_segment_filename", "seg-%06d.ts", "-hls_flags", "temp_file", LIVE_PLAYLIST],
  ];
  await mkdir(dir, { recursive: true });
  try {
    // Relative names, run inside `dir`: the playlist then refers to its segments by name.
    await run("ffmpeg", args, { cwd: dir, signal: opts.signal, stopSignal: opts.stopSignal, timeoutMs: (limit + 3600) * 1000 });
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.error("[bamio/live] following stopped:", err instanceof ProcessError ? err.stderrTail.slice(-1500) : err);
    // A stream that went offline often ends this way too; the caller keeps what was captured.
    return "error";
  }
  if (opts.stopSignal.aborted) return "stopped";
  const captured = await readFile(path.join(dir, LIVE_PLAYLIST), "utf8").then((t) => parsePlaylistWindow(t).windowSec, () => 0);
  return captured >= limit - 30 ? "limit" : "ended";
}

/**
 * A copy of the live playlist as it is now, closed with ENDLIST, for ffmpeg to read like
 * a finished video (seeking works; it doesn't wait for more). Remove it with `done`.
 */
export async function livePlaylistSnapshot(dir: string): Promise<{ file: string; durationSec: number; done: () => Promise<void> }> {
  const text = await readFile(path.join(dir, LIVE_PLAYLIST), "utf8").catch(() => "");
  if (!text.includes("#EXTINF")) throw new HttpError(409, "no_video_yet", "No video has been captured yet.");
  // Forward slashes: ffprobe 4 finds the playlist's segments next to it only with those.
  const file = path.join(dir, `snap-${randomUUID()}.m3u8`).split(path.sep).join("/");
  await writeFile(file, text.includes("#EXT-X-ENDLIST") ? text : `${text.trimEnd()}\n#EXT-X-ENDLIST\n`, "utf8");
  return { file, durationSec: parsePlaylistWindow(text).windowSec, done: () => rm(file, { force: true }) };
}

/** Seconds of video in the live playlist so far. */
export const liveCapturedSec = (dir: string) =>
  readFile(path.join(dir, LIVE_PLAYLIST), "utf8").then((t) => parsePlaylistWindow(t).windowSec, () => 0);

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
  const result = liveInfo(info.url, info.platform).then((live) => {
    const follow = followStart(live, info.live!.startedAt);
    return {
      ...info,
      live: { ...info.live!, canRewind: live.canRewind, rewindSec: Math.round(live.rewindSec), followBackSec: follow.backSec, followFromStart: follow.fromStart },
    };
  });
  liveCache.set(key, { at: Date.now(), result });
  result.catch(() => liveCache.delete(key));
  return result;
}
