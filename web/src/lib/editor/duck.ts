import type { Edit } from "./model";
import { loudLevel, silences, type Envelope } from "./silence";
import { audioLength, layout, mergeRanges, type Range } from "./timeline";

/*
 * Music that ducks under speech: a sound marked `duck` plays at a fraction of its volume while
 * someone is talking, and comes back up in the pauses. "Talking" is heard, not understood: it's
 * when the video's own sound, or another sound that doesn't duck (a voiceover), is loud. The
 * loudness was measured when the files were opened (their envelopes, see silence.ts).
 *
 * The level is a line between a few points in time, so the preview can ask what it is now and
 * the export can ramp a gain along it: both from the same points.
 */

export const DUCK = {
  /** The share of its volume a ducking sound keeps while someone talks. */
  level: 0.25,
  /** Seconds it takes to go down, finishing as the talking starts (the edit knows what's coming), and to come back. */
  attack: 0.15,
  release: 0.4,
  /** A pause shorter than this isn't a pause: the music stays down through it. Longer than attack and release together, so two dips never overlap. */
  hold: 0.7,
  /** Quieter than this share of a file's loud level counts as a pause in it. */
  threshold: 0.08,
  /** A clip or sound turned down below this isn't heard well enough to duck for. */
  audible: 0.05,
} as const;

export type DuckPoint = { t: number; level: number };

/** When a file has something to hear, in its own seconds, between `from` and `to`: everything but its pauses. */
function loudParts(envelope: Envelope, from: number, until: number): Range[] {
  // Nothing was measured past the envelope's end: nothing is heard there.
  const to = Math.min(until, envelope.values.length / envelope.rate);
  // A file with no sound to speak of never talks.
  if (to <= from || loudLevel(envelope.values) < 0.004) return [];
  const out: Range[] = [];
  let at = from;
  for (const quiet of silences(envelope, { threshold: DUCK.threshold, minSec: DUCK.hold, padSec: 0 })) {
    if (quiet.end <= from || quiet.start >= to) continue;
    if (quiet.start > at) out.push({ start: at, end: Math.min(to, quiet.start) });
    at = Math.max(at, quiet.end);
  }
  if (at < to) out.push({ start: at, end: to });
  return out;
}

/**
 * When someone is talking, on the timeline: the main track's clips with their sound on, and the
 * sounds that don't duck themselves. Joined, and never past the end of the video.
 */
export function voiceRanges(edit: Edit, envelopes: ReadonlyMap<string, Envelope>): Range[] {
  const ranges: Range[] = [];
  let total = 0;
  for (const placed of layout(edit)) {
    total = placed.to;
    const { clip } = placed;
    const envelope = envelopes.get(clip.mediaId);
    if (!envelope || clip.muted || clip.volume < DUCK.audible) continue;
    for (const part of loudParts(envelope, clip.start, clip.end)) {
      ranges.push({ start: placed.from + (part.start - clip.start) / clip.speed, end: placed.from + (part.end - clip.start) / clip.speed });
    }
  }
  for (const sound of edit.audio) {
    const envelope = envelopes.get(sound.mediaId);
    if (!envelope || sound.duck || sound.volume < DUCK.audible) continue;
    for (const part of loudParts(envelope, sound.start, sound.start + audioLength(sound))) {
      ranges.push({ start: sound.at + (part.start - sound.start), end: sound.at + (part.end - sound.start) });
    }
  }
  return mergeRanges(ranges.map((r) => ({ start: Math.max(0, r.start), end: Math.min(total, r.end) })).filter((r) => r.end - r.start > 0.02));
}

/** The level of a ducking sound over time, as the corners of its line: down before each stretch of talking, back up after it. */
export function duckPoints(voice: Range[]): DuckPoint[] {
  const points: DuckPoint[] = [];
  let before = Number.NEGATIVE_INFINITY;
  for (const range of voice) {
    // Talking that starts before the last dip has ended: the music just stays down.
    if (range.start - DUCK.attack <= before && points.length >= 2) {
      points.length -= 1;
      points[points.length - 1] = { t: range.end, level: DUCK.level };
    } else {
      points.push({ t: Math.max(0, range.start - DUCK.attack), level: 1 }, { t: range.start, level: DUCK.level }, { t: range.end, level: DUCK.level });
    }
    before = range.end + DUCK.release;
    points.push({ t: before, level: 1 });
  }
  return points;
}

/** The level at one moment (1 with nothing to duck under). */
export function duckAt(points: readonly DuckPoint[], t: number): number {
  if (points.length === 0 || t <= points[0]!.t) return points.length === 0 ? 1 : points[0]!.level;
  for (let i = 1; i < points.length; i++) {
    const b = points[i]!;
    if (t > b.t) continue;
    const a = points[i - 1]!;
    return b.t === a.t ? b.level : a.level + ((b.level - a.level) * (t - a.t)) / (b.t - a.t);
  }
  return points[points.length - 1]!.level;
}

/** Whether any sound of the edit ducks. */
export const ducks = (edit: Edit): boolean => edit.audio.some((a) => a.duck);

/** The duck line of an edit, from its files' loudness (empty when nothing ducks). */
export function duckLine(edit: Edit, envelopes: ReadonlyMap<string, Envelope>): DuckPoint[] {
  return ducks(edit) ? duckPoints(voiceRanges(edit, envelopes)) : [];
}
