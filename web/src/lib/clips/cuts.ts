import type { CaptionLine, CaptionWord } from "@/lib/clips/logic";
import type { Cut } from "@/lib/clips/fillers";

/*
 * Taking parts out of the middle of a clip, and keeping everything that is drawn on top in
 * step with it: used by filler-word removal, and ready for anything else that drops a stretch.
 *
 * The export never re-encodes twice or concatenates files: ffmpeg's `select` drops the frames
 * inside the cuts and `setpts` closes the gap (lib/clips/render.ts). The captions have to
 * move by exactly the same amount, which is what `shiftTime` is for, so this arithmetic is
 * shared by the preview, the export and the subtitle files.
 */

export type { Cut };

/** Cuts in order, overlapping or near-touching ones joined, nothing shorter than a frame. */
export function mergeCuts(cuts: readonly Cut[], minGap = 0.08): Cut[] {
  const sorted = [...cuts].filter((c) => c.end - c.start > 0.02).sort((a, b) => a.start - b.start);
  const out: Cut[] = [];
  for (const cut of sorted) {
    const last = out.at(-1);
    if (last && cut.start - last.end <= minGap) last.end = Math.max(last.end, cut.end);
    else out.push({ ...cut });
  }
  return out;
}

/** Cuts kept inside [from, to), measured from `from` (a clip's own timeline). */
export function cutsWithin(cuts: readonly Cut[], from: number, to: number): Cut[] {
  return mergeCuts(
    cuts
      .map((c) => ({ start: Math.max(c.start, from) - from, end: Math.min(c.end, to) - from }))
      .filter((c) => c.end > c.start),
  );
}

export const cutTotal = (cuts: readonly Cut[]) => mergeCuts(cuts).reduce((sum, c) => sum + (c.end - c.start), 0);

/** What a clip lasts once its cuts are taken out. */
export const cutDuration = (durationSec: number, cuts: readonly Cut[]) => Math.max(0, durationSec - cutTotal(cutsWithin(cuts, 0, durationSec)));

/**
 * Where a moment of the uncut clip lands once the cuts are closed up. A moment inside a cut
 * lands where that cut starts, since that is the frame that now follows it.
 */
export function shiftTime(cuts: readonly Cut[], t: number): number {
  let shift = 0;
  for (const cut of mergeCuts(cuts)) {
    if (cut.start >= t) break;
    shift += Math.min(t, cut.end) - cut.start;
  }
  return Math.max(0, t - shift);
}

/** True when a moment falls inside a cut, so whatever was drawn there is gone. */
export const isCut = (cuts: readonly Cut[], t: number) => mergeCuts(cuts).some((c) => t >= c.start && t < c.end);

/**
 * Caption lines with the cuts taken out: words spoken inside a cut are dropped, the rest keep
 * their words but move earlier. A line left with no words disappears; a line whose words all
 * survive reads exactly as it did.
 */
export function applyCuts(lines: readonly CaptionLine[], cuts: readonly Cut[]): CaptionLine[] {
  const merged = mergeCuts(cuts);
  if (merged.length === 0) return [...lines];
  const out: CaptionLine[] = [];
  for (const line of lines) {
    const words: CaptionWord[] = [];
    for (const word of line.words) {
      // A word is gone when the middle of it was cut away.
      if (isCut(merged, (word.start + word.end) / 2)) continue;
      const start = shiftTime(merged, word.start);
      const end = Math.max(start + 0.04, shiftTime(merged, word.end));
      words.push({ text: word.text, start, end });
    }
    if (words.length > 0) out.push({ start: words[0]!.start, end: words.at(-1)!.end, words });
  }
  return out;
}

/**
 * ffmpeg's `select` expression that keeps everything outside the cuts: `not(between(...)+...)`.
 * `between` is inclusive at both ends, so each cut is closed a hair early to keep the frame
 * that starts the kept part. "1" when there is nothing to cut.
 */
export function keepExpr(cuts: readonly Cut[]): string {
  const merged = mergeCuts(cuts);
  if (merged.length === 0) return "1";
  const parts = merged.map((c) => `between(t\\,${c.start.toFixed(3)}\\,${Math.max(c.start, c.end - 0.001).toFixed(3)})`);
  return `not(${parts.join("+")})`;
}
