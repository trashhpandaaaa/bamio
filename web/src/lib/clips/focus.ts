import { cropRect } from "@/lib/clips/logic";
import type { Aspect, FocusPoint } from "@/lib/clips/schema";

/*
 * AI face tracking for a clip: turning the faces found in it into the path its crop follows,
 * so a wide video cut to 9:16 stays on the speaker instead of sitting at one spot.
 *
 * The faces are found in the browser (components/clips/face-track.ts); this is the arithmetic,
 * so it can be tested. It is the same idea as the editor's auto-reframe (lib/editor/reframe.ts)
 * in the clip's own terms: focusX, 0 to 1. The path holds still while the speaker stays near
 * the middle and eases across when they move, because a crop that chases every twitch of a
 * detector looks worse than one that doesn't move at all.
 */

/** Where a face was at a moment of the clip, as a share of the picture's width (null: none seen). */
export type FaceAt = { t: number; x: number | null };

/** How much of the source width the crop shows (1: all of it, so there is nowhere to move). */
export function visibleWidth(srcW: number, srcH: number, aspect: Aspect): number {
  if (srcW <= 0 || srcH <= 0) return 1;
  return Math.min(1, cropRect(srcW, srcH, aspect, 0).w / srcW);
}

/** The focusX that puts a point of the picture (a share, 0 to 1) in the middle of the crop. */
export function focusFor(share: number, visible: number): number {
  if (visible >= 0.999) return 0.5;
  return Math.max(0, Math.min(1, (share - visible / 2) / (1 - visible)));
}

/** Seconds the crop takes to settle somewhere new. */
const SETTLE = 0.5;
/** A face may wander this much of the visible width either side of where the crop sits before it follows. */
const DEAD = 0.1;

/**
 * The path a clip's crop should follow, from the faces found in it. Gaps with no face hold
 * where the crop already was. Returns an empty path when no face was ever seen, which leaves
 * the clip on its own focusX.
 */
export function focusPath(samples: readonly FaceAt[], visible: number): FocusPoint[] {
  const sorted = [...samples].filter((s) => Number.isFinite(s.t)).sort((a, b) => a.t - b.t);
  const first = sorted.find((s) => s.x !== null);
  if (!first) return [];
  let face = first.x!;
  let aim = face;
  let at = face;
  let last = sorted[0]!.t;
  const out: FocusPoint[] = [];
  for (const sample of sorted) {
    if (sample.x !== null) face = sample.x;
    if (Math.abs(face - aim) > visible * DEAD) aim = face;
    const k = 1 - Math.exp(-Math.max(0, sample.t - last) / SETTLE);
    at = out.length === 0 ? aim : at + (aim - at) * k;
    last = sample.t;
    out.push({ t: round(Math.max(0, sample.t)), x: round(focusFor(at, visible)) });
  }
  return thin(out);
}

/** Points that say nothing new (the crop hasn't moved a pixel's worth) are left out. */
function thin(path: FocusPoint[]): FocusPoint[] {
  const out: FocusPoint[] = [];
  for (const point of path) {
    const last = out.at(-1);
    if (!last || Math.abs(point.x - last.x) >= 0.002) out.push(point);
  }
  return out;
}

/** Where the crop sits at a moment of the clip: the last point reached, or `fallback` before any. */
export function focusAt(path: readonly FocusPoint[], t: number, fallback: number): number {
  let x = fallback;
  for (const point of path) {
    if (point.t > t) break;
    x = point.x;
  }
  return x;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
