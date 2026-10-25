import { CanvasSink } from "mediabunny";
import type { Asset } from "@/lib/editor/assets";
import type { Clip } from "@/lib/editor/model";
import type { FaceSample } from "@/lib/editor/reframe";
import { faceDetector, facesIn, faceToFollow } from "@/components/face-detector";

/*
 * Finding faces in a clip, in the browser, for auto-reframe (lib/editor/reframe.ts turns them
 * into a path). The detector itself is components/face-detector.ts, shared with a Bamio clip's
 * face tracking. A frame every quarter second, small (320 across), is plenty to follow a face.
 */

const EVERY = 0.25;

/**
 * Where the face is in a clip, every quarter second of its file. The biggest face, or the one
 * nearest the last one when there are several (a cut to someone else is followed, a passer-by isn't).
 */
export async function findFaces(asset: Asset, clip: Clip, onProgress: (done: number) => void, signal: AbortSignal): Promise<FaceSample[]> {
  const track = asset.videoTrack;
  if (!track) return [];
  const find = await faceDetector();
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
    const face = faceToFollow(facesIn(find, frame.canvas, width, height), last);
    if (face) last = { x: face.x, y: face.y };
    out.push({ t, cx: face?.x ?? null, cy: face?.y ?? null });
    if (n % 8 === 0) onProgress(n / times.length);
  }
  onProgress(1);
  return out;
}
