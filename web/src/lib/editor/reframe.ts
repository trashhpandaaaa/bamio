import type { Clip, TrackPoint } from "./model";

/*
 * Auto-reframe: turning faces found in a clip into a path for the picture to follow, so the
 * person stays in the frame when a wide video fills a tall one. The faces are found in the
 * browser (components/editor/reframe-detect.ts); this is the arithmetic, so it can be tested:
 * the path holds still while the face stays near the middle, and eases to its new place when
 * it moves, instead of following every twitch.
 */

/** A face's middle at a second of the file, as shares of the picture (null: no face then). */
export type FaceSample = { t: number; cx: number | null; cy: number | null };

/**
 * How much of the picture the frame shows across and down (1: all of it, so there's no room
 * to move): the frame's shape against the picture's, at the clip's zoom.
 */
export function visibleShare(clip: Pick<Clip, "zoom" | "rotate">, picture: { width: number; height: number }, frame: { width: number; height: number }) {
  const turned = clip.rotate === 90 || clip.rotate === 270;
  const pw = turned ? picture.height : picture.width;
  const ph = turned ? picture.width : picture.height;
  if (pw <= 0 || ph <= 0) return { x: 1, y: 1 };
  const scale = Math.max(frame.width / pw, frame.height / ph) * clip.zoom;
  return { x: Math.min(1, frame.width / (pw * scale)), y: Math.min(1, frame.height / (ph * scale)) };
}

/** A clip's x (or y), -1 to 1, that puts a point of the picture (a share, 0 to 1) in the middle of the frame. */
export function offsetFor(share: number, visible: number): number {
  if (visible >= 0.999) return 0;
  return Math.max(-1, Math.min(1, (share - 0.5) / ((1 - visible) / 2)));
}

/** Seconds the picture takes to settle on a new place. */
const SETTLE = 0.45;

/**
 * The path for a clip's picture to follow, from faces found in it. `visible`: how much of the
 * picture the frame shows (visibleShare). Gaps with no face hold the last place (or the first
 * face found, before it); the picture moves only when the face leaves the middle part of the
 * frame, and eases there.
 */
export function reframeTrack(samples: readonly FaceSample[], visible: { x: number; y: number }): TrackPoint[] {
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const first = sorted.find((s) => s.cx !== null && s.cy !== null);
  if (!first) return [];
  // Inside this much of the visible width around the middle, a face moving doesn't move the picture.
  const dead = { x: visible.x * 0.12, y: visible.y * 0.12 };
  let face = { x: first.cx!, y: first.cy! };
  let aim = { ...face };
  let at = { ...face };
  let last = sorted[0]!.t;
  const out: TrackPoint[] = [];
  for (const sample of sorted) {
    if (sample.cx !== null && sample.cy !== null) face = { x: sample.cx, y: sample.cy };
    if (Math.abs(face.x - aim.x) > dead.x) aim = { ...aim, x: face.x };
    if (Math.abs(face.y - aim.y) > dead.y) aim = { ...aim, y: face.y };
    const k = 1 - Math.exp(-Math.max(0, sample.t - last) / SETTLE);
    at = out.length === 0 ? { ...aim } : { x: at.x + (aim.x - at.x) * k, y: at.y + (aim.y - at.y) * k };
    last = sample.t;
    out.push({ t: sample.t, x: round(offsetFor(at.x, visible.x)), y: round(offsetFor(at.y, visible.y)) });
  }
  return out;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
