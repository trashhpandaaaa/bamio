import { clipRangeError, segmentWordTimes } from "@/lib/clips/logic";
import type { Segment } from "@/lib/clips/schema";

/*
 * When a video is transcribed again, AI clips found from the old transcript may sit in the
 * wrong place (older transcripts could be minutes off). The words a clip was chosen for are
 * still in the old transcript, so find those words in the new one and move the clip there.
 */

type TimedWord = { norm: string; start: number; end: number };

const normalize = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

function timedWords(segments: Segment[]): TimedWord[] {
  return segments.flatMap((s) => segmentWordTimes(s).map((w) => ({ norm: normalize(w.text), start: w.start, end: w.end }))).filter((w) => w.norm);
}

/** The words of the old transcript whose middle falls inside [start, end]. */
function wordsInside(words: TimedWord[], start: number, end: number): TimedWord[] {
  return words.filter((w) => {
    const mid = (w.start + w.end) / 2;
    return mid >= start && mid < end;
  });
}

/** Longest common subsequence of two word lists, as matched index pairs. */
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
  }
  const pairs: [number, number][] = [];
  for (let i = a.length, j = b.length; i > 0 && j > 0; ) {
    if (a[i - 1] === b[j - 1]) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1]![j]! >= dp[i]![j - 1]!) i--;
    else j--;
  }
  return pairs.reverse();
}

export type Relocation = { start: number; end: number; matched: number };

/**
 * Where the words of [start, end] in `oldSegments` are spoken according to `newSegments`,
 * or null when they can't be found with confidence (the clip should then stay as it is).
 */
export function relocateRange(oldSegments: Segment[], newSegments: Segment[], start: number, end: number, cache?: { old: TimedWord[]; next: TimedWord[] }): Relocation | null {
  const oldWords = cache?.old ?? timedWords(oldSegments);
  const newWords = cache?.next ?? timedWords(newSegments);
  const wanted = wordsInside(oldWords, start, end).map((w) => w.norm);
  if (wanted.length < 6 || newWords.length === 0) return null;

  // Vote for where the clip's word triples occur in the new transcript.
  const triples = new Map<string, number[]>();
  for (let j = 0; j + 2 < newWords.length; j++) {
    const key = `${newWords[j]!.norm} ${newWords[j + 1]!.norm} ${newWords[j + 2]!.norm}`;
    const list = triples.get(key);
    if (list) list.push(j);
    else triples.set(key, [j]);
  }
  const votes = new Map<number, number>();
  for (let i = 0; i + 2 < wanted.length; i++) {
    for (const j of triples.get(`${wanted[i]} ${wanted[i + 1]} ${wanted[i + 2]}`) ?? []) {
      const bucket = Math.round((j - i) / 8); // near offsets vote together (the new transcript may have extra words)
      votes.set(bucket, (votes.get(bucket) ?? 0) + 1);
    }
  }
  let best: number | null = null;
  let bestVotes = 0;
  for (const [bucket, n] of votes) {
    if (n > bestVotes) {
      best = bucket;
      bestVotes = n;
    }
  }
  if (best === null || bestVotes < Math.max(2, (wanted.length - 2) * 0.15)) return null;

  // Align the clip's words against that stretch of the new transcript, word by word.
  const from = Math.max(0, best * 8 - 40);
  const to = Math.min(newWords.length, best * 8 + Math.ceil(wanted.length * 1.6) + 40);
  const window = newWords.slice(from, to);
  const pairs = lcsPairs(wanted, window.map((w) => w.norm));
  if (pairs.length < wanted.length * 0.45) return null;

  // Extend to the clip's first and last words even if those two didn't match exactly.
  const [firstOld, firstNew] = pairs[0]!;
  const [lastOld, lastNew] = pairs[pairs.length - 1]!;
  const startIdx = Math.max(0, from + firstNew - firstOld);
  const endIdx = Math.min(newWords.length - 1, from + lastNew + (wanted.length - 1 - lastOld));
  const s = newWords[startIdx]!.start;
  const e = newWords[endIdx]!.end;
  if (!(e > s)) return null;
  return { start: Math.max(0, s - 0.1), end: e + 0.25, matched: pairs.length / wanted.length };
}

/** Precomputed word lists for relocating many clips against the same two transcripts. */
export function relocationCache(oldSegments: Segment[], newSegments: Segment[]) {
  return { old: timedWords(oldSegments), next: timedWords(newSegments) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Move AI clips to where their words are spoken in the new transcript. Clips marked by
 * hand stay put (they were placed on the video itself), as do clips whose words can't be
 * found. `moved` counts clips that moved by more than a second.
 */
export function relocateAiClips<C extends { origin: "ai" | "manual"; start: number; end: number }>(
  clips: C[],
  oldSegments: Segment[],
  newSegments: Segment[],
  durationSec: number,
): { clips: C[]; moved: number } {
  const cache = relocationCache(oldSegments, newSegments);
  let moved = 0;
  const out = clips.map((clip) => {
    if (clip.origin !== "ai") return clip;
    const found = relocateRange(oldSegments, newSegments, clip.start, clip.end, cache);
    if (!found) return clip;
    const start = round2(found.start);
    const end = round2(Math.min(durationSec, found.end));
    if (clipRangeError(start, end, durationSec)) return clip;
    if (Math.abs(start - clip.start) > 1 || Math.abs(end - clip.end) > 1) moved++;
    return { ...clip, start, end };
  });
  return { clips: out, moved };
}
