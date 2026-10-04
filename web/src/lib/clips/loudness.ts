/*
 * How loud a video is, second by second (dBFS of its audio, rounded): measured from the audio
 * decoded for transcription, kept with the transcript, and shown to the clip finder as a hint of
 * hype (shouting, cheering, laughter, a crowd going off). Pure, so it's unit-tested.
 */

export const SILENT_DB = -90;

/** Loudness of the power average of some samples' squares, in dBFS (16-bit full scale), never below SILENT_DB. */
const toDb = (sumSquares: number, count: number) =>
  count === 0 || sumSquares === 0 ? SILENT_DB : Math.max(SILENT_DB, Math.round(10 * Math.log10(sumSquares / count / (32768 * 32768))));

/**
 * Measures 16-bit mono samples as they stream in: one value per whole second (a last part
 * second counts when it's at least a quarter of a second).
 */
export function loudnessMeter(rate: number) {
  const out: number[] = [];
  let sum = 0;
  let n = 0;
  return {
    push(samples: Int16Array) {
      for (let i = 0; i < samples.length; i++) {
        const s = samples[i]!;
        sum += s * s;
        if (++n === rate) {
          out.push(toDb(sum, n));
          sum = 0;
          n = 0;
        }
      }
    },
    done(): number[] {
      if (n >= rate / 4) out.push(toDb(sum, n));
      return out;
    },
  };
}

/** A followed stream's newest piece (its loudness from second `from`) laid over what the transcript had. */
export function mergeLoudness(before: number[] | undefined, piece: number[] | undefined, from: number): number[] | undefined {
  if (!piece?.length) return before;
  const at = Math.max(0, Math.round(from));
  const head = (before ?? []).slice(0, at);
  while (head.length < at) head.push(SILENT_DB);
  return [...head, ...piece];
}

/**
 * A mark for each transcript line: "!!" for the loudest (top 5%), "!" for loud (top 20%), "" for
 * the rest; none at all when the video's loudness hardly varies (one tone throughout: nothing
 * stands out). A line's loudness is the power average of its seconds.
 */
export function loudnessMarks(lines: { start: number; end: number }[], loudness: number[] | undefined): string[] {
  const none = lines.map(() => "");
  if (!loudness?.length || lines.length < 5) return none;
  const level = lines.map((l) => {
    const from = Math.max(0, Math.floor(l.start));
    const to = Math.min(loudness.length, Math.max(from + 1, Math.ceil(l.end)));
    let power = 0;
    for (let s = from; s < to; s++) power += 10 ** (loudness[s]! / 10);
    return to > from ? 10 * Math.log10(power / (to - from)) : SILENT_DB;
  });
  const sorted = [...level].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const median = at(0.5);
  const loud = at(0.8);
  const loudest = at(0.95);
  // Under 4 dB between the middle and the top: no real peaks to point out.
  if (loudest - median < 4) return none;
  // Clearly above the typical level too (3 dB, 6 dB): where most lines share one level, the top
  // fifth can be that level itself.
  return level.map((v) => (v >= loudest && v >= median + 6 ? "!!" : v >= loud && v >= median + 3 ? "!" : ""));
}
