import { CanvasSink } from "mediabunny";
import type { Asset } from "@/lib/editor/assets";
import type { Clip } from "@/lib/editor/model";
import type { FaceSample } from "@/lib/editor/reframe";

/*
 * Finding faces in a clip, in the browser, for auto-reframe (lib/editor/reframe.ts turns them
 * into a path). MediaPipe's face detector, its code served by Bamio (/vendor/mediapipe) and its
 * small model from /mediapipe: nothing about the video leaves the device. A frame every quarter
 * second, small (320 across), is plenty to follow a face.
 */

const EVERY = 0.25;

type Detector = { detect(image: HTMLCanvasElement | OffscreenCanvas): { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number } }[] }; close(): void };

let loading: Promise<Detector> | null = null;

async function detector(): Promise<Detector> {
  loading ??= (async () => {
    const vision = await import("@mediapipe/tasks-vision");
    const files = await vision.FilesetResolver.forVisionTasks("/vendor/mediapipe");
    return (await vision.FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: "/mediapipe/blaze_face_short_range.tflite" },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
    })) as unknown as Detector;
  })();
  return loading;
}

/**
 * Where the face is in a clip, every quarter second of its file. The biggest face, or the one
 * nearest the last one when there are several (a cut to someone else is followed, a passer-by isn't).
 */
export async function findFaces(asset: Asset, clip: Clip, onProgress: (done: number) => void, signal: AbortSignal): Promise<FaceSample[]> {
  const track = asset.videoTrack;
  if (!track) return [];
  const find = await detector();
  const wide = track.displayWidth >= track.displayHeight;
  const sink = new CanvasSink(track, wide ? { width: 320 } : { height: 320 });
  const times: number[] = [];
  for (let t = clip.start; t < clip.end; t += EVERY) times.push(t);
  const out: FaceSample[] = [];
  let last: { x: number; y: number } | null = null;
  let n = 0;
  for await (const frame of sink.canvasesAtTimestamps(times)) {
    if (signal.aborted) throw new DOMException("Stopped.", "AbortError");
    const t = times[n++]!;
    if (!frame) {
      out.push({ t, cx: null, cy: null });
      continue;
    }
    const { width, height } = frame.canvas;
    const faces = find
      .detect(frame.canvas)
      .detections.map((d) => d.boundingBox)
      .filter((b): b is NonNullable<typeof b> => Boolean(b))
      .map((b) => ({ x: (b.originX + b.width / 2) / width, y: (b.originY + b.height / 2) / height, size: b.width * b.height }));
    let face = faces.sort((a, b) => b.size - a.size)[0];
    if (last && faces.length > 1) {
      const near = faces.reduce((a, b) => (Math.hypot(a.x - last!.x, a.y - last!.y) < Math.hypot(b.x - last!.x, b.y - last!.y) ? a : b));
      if (near.size > face!.size * 0.5) face = near;
    }
    if (face) last = { x: face.x, y: face.y };
    out.push({ t, cx: face?.x ?? null, cy: face?.y ?? null });
    if (n % 8 === 0) onProgress(n / times.length);
  }
  onProgress(1);
  return out;
}
