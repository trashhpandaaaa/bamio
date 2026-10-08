import type { Edit } from "./model";
import { layout, mergeRanges, type Range } from "./timeline";

/*
 * Finding the silences in a video's sound, to cut them out in one go ("Remove silences"). The
 * editor measures how loud each 20 ms of a file is when it's added (an envelope, also drawn as
 * the waveform); the quiet stretches between speech are what this finds.
 */

/** How loud a file is over time: `rate` values a second, each the loudest sample of its window (0 to 1). */
export type Envelope = { rate: number; values: Float32Array | number[] };

export const SILENCE_PRESETS = {
  gentle: { label: "Gentle", hint: "Long pauses only", threshold: 0.05, minSec: 0.9, padSec: 0.18 },
  normal: { label: "Normal", hint: "Pauses between sentences", threshold: 0.07, minSec: 0.5, padSec: 0.12 },
  tight: { label: "Tight", hint: "Every gap, fast cuts", threshold: 0.1, minSec: 0.28, padSec: 0.07 },
} as const;
export type SilencePreset = keyof typeof SILENCE_PRESETS;
export type SilenceOptions = { threshold: number; minSec: number; padSec: number };

/** The level loud parts of a file reach: its 95th percentile, so one clap doesn't set the scale. */
export function loudLevel(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  const sorted = Float32Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

/**
 * The quiet stretches of a file, in its own seconds: quieter than `threshold` times its loud
 * level for at least `minSec`, each shortened by `padSec` at both ends so words aren't clipped
 * and a breath of pause stays.
 */
export function silences(envelope: Envelope, options: SilenceOptions): Range[] {
  const { values, rate } = envelope;
  const loud = loudLevel(values);
  // A file with no sound to speak of has no pauses to find.
  if (loud < 0.004) return [];
  const limit = loud * options.threshold;
  const out: Range[] = [];
  let from = -1;
  for (let i = 0; i <= values.length; i++) {
    const quiet = i < values.length && (values[i] ?? 0) < limit;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      const start = from / rate + options.padSec;
      const end = i / rate - options.padSec;
      if (i - from >= options.minSec * rate && end - start > 0.05) out.push({ start, end });
      from = -1;
    }
  }
  return out;
}

/**
 * Where to cut the main track to take the silences out: timeline ranges, joined. Only clips
 * with sound that's on are looked at, and a clip that's (almost) all quiet is left whole: it's
 * more likely footage without speech than one long pause.
 */
export function silenceCuts(edit: Edit, envelopes: ReadonlyMap<string, Envelope>, options: SilenceOptions): { ranges: Range[]; seconds: number } {
  const ranges: Range[] = [];
  const quiet = new Map<string, Range[]>();
  for (const placed of layout(edit)) {
    const { clip } = placed;
    const envelope = envelopes.get(clip.mediaId);
    if (!envelope || clip.muted || clip.volume === 0) continue;
    if (!quiet.has(clip.mediaId)) quiet.set(clip.mediaId, silences(envelope, options));
    const cuts: Range[] = [];
    for (const s of quiet.get(clip.mediaId)!) {
      const start = Math.max(s.start, clip.start);
      const end = Math.min(s.end, clip.end);
      if (end - start <= 0.05) continue;
      cuts.push({ start: placed.from + (start - clip.start) / clip.speed, end: placed.from + (end - clip.start) / clip.speed });
    }
    const gone = cuts.reduce((sum, c) => sum + (c.end - c.start), 0);
    if (gone > 0 && gone < 0.9 * (placed.to - placed.from)) ranges.push(...cuts);
  }
  const merged = mergeRanges(ranges);
  return { ranges: merged, seconds: merged.reduce((sum, r) => sum + (r.end - r.start), 0) };
}

/** An envelope from sound samples: the loudest sample of every window, `rate` windows a second. */
export function envelopeOf(samples: Float32Array, sampleRate: number, rate = 50): Float32Array {
  const size = Math.max(1, Math.round(sampleRate / rate));
  const out = new Float32Array(Math.ceil(samples.length / size));
  for (let w = 0; w < out.length; w++) {
    let peak = 0;
    const end = Math.min(samples.length, (w + 1) * size);
    for (let i = w * size; i < end; i++) {
      const v = Math.abs(samples[i]!);
      if (v > peak) peak = v;
    }
    out[w] = peak;
  }
  return out;
}
