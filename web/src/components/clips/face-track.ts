import { faceDetector, facesIn, faceToFollow } from "@/components/face-detector";
import type { FaceAt } from "@/lib/clips/focus";

/*
 * AI face tracking for a Bamio clip (Pro), found in the browser so the server does no extra
 * work and the video is read only once, from where it already is.
 *
 * The clip is *played* rather than seeked: a video element on a remote file takes about as
 * long to seek as to play, and a hundred seeks over one clip would take minutes. A hidden
 * element plays the clip's own stretch at several times speed, muted, and a frame is sampled
 * every quarter second of the clip's time. A 60-second clip takes about 15 seconds.
 *
 * lib/clips/focus.ts turns the result into the path the crop follows.
 */

/** A frame this often (in the clip's own seconds). */
const EVERY = 0.25;
/** How fast the clip is played while sampling. Browsers mute and drop frames above about 8. */
const SPEED = 6;
/** The frames are measured this wide; a face needs nothing more. */
const SAMPLE_WIDTH = 320;

export type TrackOptions = {
  /** The video file to read: the project's source. */
  src: string;
  start: number;
  end: number;
  onProgress?: (done: number) => void;
  signal?: AbortSignal;
};

/**
 * Where the speaker is through a clip. The times returned are relative to the clip's start,
 * which is what the focus path wants. Throws if the browser can't play or decode the file.
 */
export async function trackFaces({ src, start, end, onProgress, signal }: TrackOptions): Promise<FaceAt[]> {
  const span = Math.max(0, end - start);
  if (span <= 0) return [];
  const find = await faceDetector();
  // Its own element, so the clip editor's preview keeps playing as it was.
  const video = document.createElement("video");
  video.src = src;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.crossOrigin = "anonymous";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser can’t read frames from a video.");

  try {
    await once(video, "loadedmetadata", signal);
    const ratio = video.videoWidth > 0 ? video.videoHeight / video.videoWidth : 9 / 16;
    canvas.width = SAMPLE_WIDTH;
    canvas.height = Math.max(2, Math.round(SAMPLE_WIDTH * ratio));
    video.currentTime = start;
    await once(video, "seeked", signal);
    video.playbackRate = SPEED;
    await video.play();

    const out: FaceAt[] = [];
    let last: { x: number; y: number } | null = null;
    let next = start;
    while (!video.ended && video.currentTime < end) {
      throwIfAborted(signal);
      if (video.currentTime + 0.001 >= next) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const face = faceToFollow(facesIn(find, canvas, canvas.width, canvas.height), last);
        if (face) last = { x: face.x, y: face.y };
        out.push({ t: round(Math.min(span, video.currentTime - start)), x: face ? round(face.x) : null });
        next += EVERY;
        onProgress?.(Math.min(1, (video.currentTime - start) / span));
      }
      await frame();
    }
    onProgress?.(1);
    return out;
  } finally {
    video.pause();
    // Let go of the file: without this the element keeps the connection open.
    video.removeAttribute("src");
    video.load();
  }
}

/** How many faces were seen, so the editor can say "no face found" instead of silently doing nothing. */
export const facesSeen = (samples: readonly FaceAt[]) => samples.filter((s) => s.x !== null).length;

const round = (v: number) => Math.round(v * 1000) / 1000;

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new DOMException("Stopped.", "AbortError");
}

/** The next drawn frame (or the next tick, where the browser has no frame callback). */
function frame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function once(video: HTMLVideoElement, event: "loadedmetadata" | "seeked", signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    if (event === "loadedmetadata" && video.readyState >= 1) return resolve();
    const done = () => {
      cleanup();
      resolve();
    };
    const failed = () => {
      cleanup();
      reject(new Error("This browser can’t read that video."));
    };
    const stopped = () => {
      cleanup();
      reject(new DOMException("Stopped.", "AbortError"));
    };
    const cleanup = () => {
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
      signal?.removeEventListener("abort", stopped);
    };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
    signal?.addEventListener("abort", stopped, { once: true });
  });
}
