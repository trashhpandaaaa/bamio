/*
 * Loudness levelling: bringing an export to the loudness TikTok, Reels and Shorts play at
 * (about -14 LUFS), so it isn't quieter than the videos around it, nor clipped. The export
 * measures its own mix first (K-weighted, in 100 ms pieces, export.ts), then plays it through
 * a gain and a limiter. This is the arithmetic of the measurement (ITU-R BS.1770: 400 ms
 * blocks overlapping by 75%, gated at -70 LUFS and at 10 LU under the level of what's left).
 */

/** What the apps play at. */
export const TARGET_LUFS = -14;
/** The most a quiet video is turned up, in dB (more would only raise its noise). */
const MAX_BOOST = 12;
/** The most a loud one is turned down. */
const MAX_CUT = 20;

/** 400 ms blocks (each the mean of four 100 ms pieces' mean squares), every 100 ms. */
export function blocksOf(pieces: readonly number[]): number[] {
  const blocks: number[] = [];
  for (let i = 0; i + 4 <= pieces.length; i++) blocks.push((pieces[i]! + pieces[i + 1]! + pieces[i + 2]! + pieces[i + 3]!) / 4);
  return blocks;
}

const lufs = (meanSquare: number) => -0.691 + 10 * Math.log10(meanSquare);

/** The integrated loudness of K-weighted blocks' mean squares, in LUFS (-Infinity for silence). */
export function integratedLoudness(blocks: readonly number[]): number {
  const loud = blocks.filter((b) => b > 0 && lufs(b) > -70);
  if (loud.length === 0) return -Infinity;
  const relative = lufs(loud.reduce((a, b) => a + b, 0) / loud.length) - 10;
  const kept = loud.filter((b) => lufs(b) > relative);
  if (kept.length === 0) return -Infinity;
  return lufs(kept.reduce((a, b) => a + b, 0) / kept.length);
}

/**
 * K-weighting (the standard's two filters, at 48 kHz), carried across the pieces of a mix:
 * `state` keeps each channel's filter memory between calls. Returns the mean square of each
 * whole 100 ms piece of the K-weighted sound, the channels added together; the rest of a
 * piece waits in `state` for the next call.
 */
export type KState = { filters: Float64Array[]; carry: { sum: number; n: number } };
export const kState = (channels: number): KState => ({ filters: Array.from({ length: channels }, () => new Float64Array(8)), carry: { sum: 0, n: 0 } });

const SHELF = { b0: 1.53512485958697, b1: -2.69169618940638, b2: 1.19839281085285, a1: -1.69065929318241, a2: 0.73248077421585 };
const HIGHPASS = { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 };
/** Samples in 100 ms at 48 kHz. */
const PIECE = 4800;

export function kWeightedPieces(channels: readonly Float32Array[], state: KState): number[] {
  const length = channels[0]?.length ?? 0;
  const squares = new Float64Array(length);
  channels.forEach((samples, c) => {
    // x1 x2 y1 y2 of the shelf, then of the high-pass.
    const m = state.filters[c] ?? (state.filters[c] = new Float64Array(8));
    for (let i = 0; i < length; i++) {
      const x = samples[i]!;
      const y = SHELF.b0 * x + SHELF.b1 * m[0]! + SHELF.b2 * m[1]! - SHELF.a1 * m[2]! - SHELF.a2 * m[3]!;
      m[1] = m[0]!;
      m[0] = x;
      m[3] = m[2]!;
      m[2] = y;
      const z = HIGHPASS.b0 * y + HIGHPASS.b1 * m[4]! + HIGHPASS.b2 * m[5]! - HIGHPASS.a1 * m[6]! - HIGHPASS.a2 * m[7]!;
      m[5] = m[4]!;
      m[4] = y;
      m[7] = m[6]!;
      m[6] = z;
      squares[i] = squares[i]! + z * z;
    }
  });
  const pieces: number[] = [];
  for (let i = 0; i < length; i++) {
    state.carry.sum += squares[i]!;
    state.carry.n += 1;
    if (state.carry.n === PIECE) {
      pieces.push(state.carry.sum / PIECE);
      state.carry = { sum: 0, n: 0 };
    }
  }
  return pieces;
}

/** The gain (a multiplier) that brings a mix of this loudness to the target: 1 for silence. */
export function levelGain(loudness: number, target = TARGET_LUFS): number {
  if (!Number.isFinite(loudness)) return 1;
  const db = Math.max(-MAX_CUT, Math.min(MAX_BOOST, target - loudness));
  return 10 ** (db / 20);
}
