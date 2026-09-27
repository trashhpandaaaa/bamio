import type { Project } from "@/lib/project/schema";
import { buildTimeline } from "@/lib/project/timeline";
import { closeImages, loadImages, loadVoice, scheduleVoice, stopSources } from "@/lib/render/media";
import { canvasFontFamily, ensureCanvasFont, EXPORT_SIZE, renderFrame } from "@/lib/render/renderer";

/*
 * Real-time export: the renderer draws into a 1080 x 1920 canvas while
 * MediaRecorder captures it together with the voice-over mix.
 */

const MIME_CANDIDATES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];

export function pickRecordingMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export function canExport(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    pickRecordingMime() !== null &&
    typeof AudioContext !== "undefined"
  );
}

export function extensionFor(mime: string): "mp4" | "webm" {
  return mime.startsWith("video/mp4") ? "mp4" : "webm";
}

export type ExportResult = { blob: Blob; mime: string; durationSec: number };

export async function exportVideo(
  project: Project,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<ExportResult> {
  const mime = pickRecordingMime();
  if (!mime || !canExport()) throw new Error("This browser can’t record video. Use a recent Chrome, Edge or Firefox.");
  const timeline = buildTimeline(project);
  if (timeline.total <= 0) throw new Error("Add at least one scene before exporting.");

  const fontFamily = canvasFontFamily();
  await ensureCanvasFont(fontFamily);

  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_SIZE.width;
  canvas.height = EXPORT_SIZE.height;
  // Kept in the DOM (invisible) because some browsers only capture attached canvases reliably.
  Object.assign(canvas.style, { position: "fixed", left: "-10000px", top: "0", width: "108px", height: "192px", pointerEvents: "none" });
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d", { alpha: false });
  const audio = new AudioContext();
  const images = await loadImages(project);
  const cleanup: (() => void)[] = [
    () => canvas.remove(),
    () => closeImages(images),
    () => void audio.close().catch(() => undefined),
  ];

  try {
    if (!ctx) throw new Error("Couldn’t start the video renderer.");
    const voice = await loadVoice(audio, project);
    const rc = { project, timeline, assets: { images }, fontFamily };
    renderFrame(ctx, rc, 0);

    const stream = canvas.captureStream(30);
    const destination = audio.createMediaStreamDestination();
    if (voice.size > 0) for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    cleanup.push(() => stream.getTracks().forEach((t) => t.stop()));

    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 160_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new Error("Recording failed. Try exporting again."));
    });

    await audio.resume();
    const start = audio.currentTime + 0.15;
    const sources = scheduleVoice(audio, destination, timeline, voice, 0, start);
    cleanup.push(() => stopSources(sources));
    recorder.start(500);

    await new Promise<void>((resolve, reject) => {
      let frame = 0;
      const onAbort = () => {
        cancelAnimationFrame(frame);
        reject(new DOMException("Export cancelled.", "AbortError"));
      };
      if (opts.signal?.aborted) return onAbort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      const tick = () => {
        const t = audio.currentTime - start;
        renderFrame(ctx, rc, Math.max(0, t));
        opts.onProgress?.(Math.min(1, Math.max(0, t / timeline.total)));
        if (t >= timeline.total + 0.1) {
          opts.signal?.removeEventListener("abort", onAbort);
          resolve();
        } else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }).finally(() => {
      if (recorder.state !== "inactive") recorder.stop();
    });

    await stopped;
    const blob = new Blob(chunks, { type: mime.split(";")[0] });
    if (blob.size === 0) throw new Error("The recording came out empty. Keep this tab visible while exporting, then try again.");
    return { blob, mime: mime.split(";")[0]!, durationSec: timeline.total };
  } finally {
    for (const fn of cleanup.reverse()) fn();
  }
}
