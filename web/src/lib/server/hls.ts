import "server-only";

/*
 * Live HLS streams as yt-dlp describes them: choosing what to record, and measuring how
 * much history the live playlist keeps (YouTube DVR streams: up to hours; Twitch and Kick
 * live playlists: about 30 s).
 */

export type Format = {
  url?: string;
  protocol?: string;
  vcodec?: string;
  acodec?: string;
  height?: number;
  tbr?: number;
  http_headers?: Record<string, string>;
};

/**
 * The ways to record a live stream, simplest first: one combined stream, and video plus
 * audio. They can keep different amounts of history: on YouTube the combined playlist
 * (listed only some of the time) keeps 30 s while the separate ones keep the rewind window.
 */
export function inputChoices(formats: Format[]): Format[][] {
  const hls = formats.filter((f) => f.url && (f.protocol ?? "").startsWith("m3u8"));
  const byQuality = (a: Format, b: Format) => (b.height ?? 0) - (a.height ?? 0) || (b.tbr ?? 0) - (a.tbr ?? 0);
  const combined = hls.filter((f) => f.vcodec !== "none" && f.acodec !== "none" && (f.height ?? 0) <= 1080).sort(byQuality)[0];
  const video = hls.filter((f) => f.vcodec !== "none" && f.acodec === "none" && (f.height ?? 0) <= 1080).sort(byQuality)[0];
  const audio = hls.filter((f) => f.acodec !== "none" && f.vcodec === "none").sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
  const choices: Format[][] = [];
  if (combined) choices.push([combined]);
  if (video && audio) choices.push([video, audio]);
  if (choices.length === 0) {
    const any = hls.filter((f) => f.vcodec !== "none").sort(byQuality)[0];
    if (any) choices.push([any]);
  }
  return choices;
}

/** Sum of segment lengths and the target segment length, from a media playlist's text. */
export function parsePlaylistWindow(text: string): { windowSec: number; segmentSec: number } {
  const durations = [...text.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
  const windowSec = durations.reduce((a, b) => a + b, 0);
  const target = Number(/#EXT-X-TARGETDURATION:(\d+(?:\.\d+)?)/.exec(text)?.[1]);
  const segmentSec = Number.isFinite(target) && target > 0 ? target : durations.length ? windowSec / durations.length : 2;
  return { windowSec, segmentSec };
}

/**
 * The segment of a media playlist that holds time `t` (seconds from its first segment):
 * its index and where it starts. Past the end: the last segment.
 */
export function segmentAt(text: string, t: number): { index: number; start: number } {
  const durations = [...text.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
  let start = 0;
  for (let i = 0; i < durations.length; i++) {
    if (t < start + durations[i]! || i === durations.length - 1) return { index: i, start };
    start += durations[i]!;
  }
  return { index: 0, start: 0 };
}

/** A URL's text, tried three times on network errors (a long VOD's playlist is over a megabyte). */
async function fetchText(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers, signal });
      if (!res.ok) throw Object.assign(new Error(`playlist HTTP ${res.status}`), { http: true });
      return await res.text();
    } catch (err) {
      if (signal?.aborted || (err as { http?: boolean }).http || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** A playlist's text (for a master playlist, its first variant's). */
export async function playlistText(f: Format, signal?: AbortSignal): Promise<string> {
  const text = await fetchText(f.url!, f.http_headers ?? {}, signal);
  if (!text.includes("#EXT-X-STREAM-INF")) return text;
  const variant = text.split(/\r?\n/).find((l) => l && !l.startsWith("#"));
  return variant ? playlistText({ ...f, url: new URL(variant, f.url).href }, signal) : "";
}

export type Recording = { inputs: Format[]; windowSec: number; segmentSec: number };

/**
 * Every way to record the stream, with how much history its playlist holds right now.
 * A playlist that can't be read counts as `fallback`.
 */
export async function measureChoices(
  formats: Format[],
  fallback: { windowSec: number; segmentSec: number },
  signal?: AbortSignal,
): Promise<Recording[]> {
  return Promise.all(
    inputChoices(formats).map(async (inputs) => {
      const window = await playlistWindow(inputs[0]!, signal).catch((err: unknown) => {
        if (signal?.aborted) throw err;
        return fallback;
      });
      return { inputs, ...window };
    }),
  );
}

/** How much history a live input's playlist holds right now. */
export async function playlistWindow(f: Format, signal?: AbortSignal): Promise<{ windowSec: number; segmentSec: number }> {
  return parsePlaylistWindow(await playlistText(f, signal));
}
