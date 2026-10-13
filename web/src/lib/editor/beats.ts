import type { AudioClip, Edit } from "./model";
import { audioLength, clipLength } from "./timeline";

/*
 * Finding the beat of a piece of music, and putting the cuts on it ("Cut to the beat"). The
 * music's low end is measured every 10 ms; where it jumps is an onset (a kick, a snare). The
 * tempo is the spacing that lines up most onsets (60 to 180 beats a minute), and the beats are
 * that spacing laid where it catches the most of them. Pure arithmetic on samples: the browser
 * decodes the sound (beats-detect is in the panel).
 */

const HOP = 0.01;

/** How sharply the music's low end rises, every 10 ms. */
export function onsetEnvelope(samples: Float32Array, rate: number): Float32Array {
  const hop = Math.max(1, Math.round(rate * HOP));
  const frames = Math.floor(samples.length / hop);
  // A one-pole low-pass (about 180 Hz): the kick and the bass carry the beat.
  const k = 1 - Math.exp((-2 * Math.PI * 180) / rate);
  let low = 0;
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      low += k * (samples[i]! - low);
      sum += low * low + 0.15 * samples[i]! * samples[i]!;
    }
    energy[f] = Math.log1p(1000 * (sum / hop));
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f]! - energy[f - 1]!);
  return onset;
}

/** The tempo that lines up the most onsets: frames between beats, and beats a minute. */
export function estimateTempo(onset: Float32Array): { period: number; bpm: number } {
  const minLag = Math.round(60 / 180 / HOP);
  const maxLag = Math.round(60 / 60 / HOP);
  let best = { lag: Math.round(0.5 / HOP), score: -Infinity };
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = lag; i < onset.length; i++) sum += onset[i]! * onset[i - lag]!;
    // A gentle lean towards 120 a minute, where most music sits: halves and doubles score close.
    const bpm = 60 / (lag * HOP);
    const score = (sum / (onset.length - lag)) * Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.2) ** 2);
    if (score > best.score) best = { lag, score };
  }
  return { period: best.lag, bpm: Math.round((60 / (best.lag * HOP)) * 10) / 10 };
}

/** Beats in seconds: the tempo laid where it catches the most onsets, each nudged to the onset nearest it. */
export function beatGrid(onset: Float32Array, period: number): number[] {
  if (onset.length === 0 || period <= 0) return [];
  let phase = 0;
  let best = -Infinity;
  for (let p = 0; p < period; p++) {
    let sum = 0;
    for (let i = p; i < onset.length; i += period) sum += Math.max(onset[i - 1] ?? 0, onset[i]!, onset[i + 1] ?? 0);
    if (sum > best) {
      best = sum;
      phase = p;
    }
  }
  const beats: number[] = [];
  for (let i = phase; i < onset.length; i += period) {
    let at = i;
    for (let j = Math.max(0, i - 2); j <= Math.min(onset.length - 1, i + 2); j++) if (onset[j]! > onset[at]!) at = j;
    beats.push(Math.round(at * HOP * 1000) / 1000);
  }
  return beats;
}

/** The beats of a piece of music, in its own seconds. Quiet or beatless sound gives none. */
export function detectBeats(samples: Float32Array, rate: number): { bpm: number; beats: number[] } {
  const onset = onsetEnvelope(samples, rate);
  const strength = onset.reduce((a, b) => a + b, 0) / Math.max(1, onset.length);
  if (onset.length < 300 || strength < 1e-3) return { bpm: 0, beats: [] };
  const { period, bpm } = estimateTempo(onset);
  return { bpm, beats: beatGrid(onset, period) };
}

/** A sound's beats where they fall on the timeline. */
export function timelineBeats(edit: Edit): number[] {
  const out: number[] = [];
  for (const sound of edit.audio) {
    for (const beat of sound.beats ?? []) if (beat >= sound.start && beat <= sound.end) out.push(sound.at + (beat - sound.start));
  }
  return out.sort((a, b) => a - b);
}

/** The shortest a clip is made when it's fitted to the beat. */
const SHORTEST = 0.25;

/**
 * Put the main track's cuts on the beat: each clip's end moves to the beat nearest it, as far as
 * its file allows (a photo or a freeze frame can be any length). Clips keep their order and
 * their starts in their files; only their lengths change.
 */
export function cutToBeat(edit: Edit, beats: readonly number[]): Edit {
  if (beats.length === 0 || edit.clips.length === 0) return edit;
  let t = 0;
  const clips = edit.clips.map((clip) => {
    const media = edit.media.find((m) => m.id === clip.mediaId);
    const still = media?.kind === "image" || Boolean(clip.freeze);
    // The latest this clip can end on the timeline.
    const latest = still ? t + 60 : t + ((media?.duration ?? clip.end) - clip.start) / clip.speed;
    const wanted = t + clipLength(clip);
    const fits = beats.filter((b) => b >= t + SHORTEST && b <= latest + 1e-6);
    if (fits.length === 0) {
      t = wanted;
      return clip;
    }
    const end = fits.reduce((a, b) => (Math.abs(b - wanted) < Math.abs(a - wanted) ? b : a));
    const length = end - t;
    t = end;
    return { ...clip, end: clip.start + length * clip.speed };
  });
  return { ...edit, clips, updatedAt: Date.now() };
}

/** Whether a sound is long enough to find a beat in. */
export const hasRoomForBeats = (sound: AudioClip) => audioLength(sound) >= 3;
