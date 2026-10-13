import { hasNoSpaceScript, joinWords, splitWords, textEm } from "@/lib/clips/logic";
import type { CaptionStyleId, CaptionWord, Edit } from "./model";
import { audioLength, mergeRanges, momentAt, totalDuration, type Range } from "./timeline";

/*
 * Captions in the editor: words kept per file in the file's own seconds (model.ts), grouped
 * into the lines shown on screen. Because the words belong to the file, they stay with what's
 * said however the clips are cut, moved or sped up: at any moment the caption is the line of
 * the file playing at that second. The grouping follows Bamio's clip captions (lib/clips/logic).
 */

/** Words on a line, by style: Pop's few big ones, the others a phrase. */
export const WORDS_PER_LINE: Record<CaptionStyleId, number> = { pop: 3, karaoke: 5, clean: 7, boxed: 6 };
/** A pause this long between words ends a line. */
const PAUSE = 0.7;
/** A line stays this long after its last word, unless the next starts sooner. */
const HOLD = 0.5;
/** The widest a line of a script written without spaces may be, in ems (it can't wrap at a space). */
const MAX_LINE_EM = 12;

/** A line of a caption, in its file's seconds. */
export type CaptionLine = { start: number; end: number; words: CaptionWord[] };

/** Words as lines, by style. */
export function captionLines(words: readonly CaptionWord[], style: CaptionStyleId): CaptionLine[] {
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const perLine = WORDS_PER_LINE[style];
  const groups: CaptionWord[][] = [];
  let chunk: CaptionWord[] = [];
  for (const word of sorted) {
    const last = chunk.at(-1);
    const tooWide = chunk.length > 0 && hasNoSpaceScript(word.text) && textEm(joinWords([...chunk.map((w) => w.text), word.text])) > MAX_LINE_EM;
    if (chunk.length >= perLine || (last && word.start - last.end > PAUSE) || tooWide) {
      groups.push(chunk);
      chunk = [];
    }
    chunk.push(word);
  }
  if (chunk.length > 0) groups.push(chunk);
  return groups.map((group, i) => {
    const next = groups[i + 1]?.[0];
    const end = group.at(-1)!.end + HOLD;
    return { start: group[0]!.start, end: next ? Math.max(group.at(-1)!.end, Math.min(end, next.start)) : end, words: group };
  });
}

const cache = new WeakMap<readonly CaptionWord[], Map<CaptionStyleId, CaptionLine[]>>();

/** captionLines, remembered for the same words (the preview asks every frame). */
export function linesOf(words: readonly CaptionWord[], style: CaptionStyleId): CaptionLine[] {
  let byStyle = cache.get(words);
  if (!byStyle) cache.set(words, (byStyle = new Map()));
  let lines = byStyle.get(style);
  if (!lines) byStyle.set(style, (lines = captionLines(words, style)));
  return lines;
}

/** What a caption shows: its words, the one being said (-1 before the first), and the file they're from. */
export type CaptionShown = { words: CaptionWord[]; active: number; mediaId: string };

/** The line at a second of a file, keeping only the words inside [from, to) of it (the part being played). */
function lineAt(lines: CaptionLine[], source: number, from: number, to: number, mediaId: string): CaptionShown | null {
  const line = lines.find((l) => source >= l.start && source < l.end);
  if (!line) return null;
  const words = line.words.filter((w) => w.start >= from - 0.05 && w.start < to);
  if (words.length === 0) return null;
  let active = -1;
  words.forEach((w, i) => {
    if (w.start <= source) active = i;
  });
  return { words, active, mediaId };
}

/**
 * The caption at a moment of the timeline: the line being said in the main track's clip if it
 * has words there, otherwise in a sound (a voiceover). Null when captions are off or nobody is
 * talking.
 */
export function captionAt(edit: Edit, t: number): CaptionShown | null {
  const captions = edit.captions;
  if (!captions?.on || t < 0 || t >= totalDuration(edit)) return null;
  const moment = momentAt(edit, t);
  if (moment && !moment.clip.freeze && !moment.clip.muted) {
    const words = captions.words[moment.clip.mediaId];
    if (words?.length) {
      const shown = lineAt(linesOf(words, captions.style), moment.source, moment.clip.start, moment.clip.end, moment.clip.mediaId);
      if (shown) return shown;
    }
  }
  for (const sound of edit.audio) {
    const words = captions.words[sound.mediaId];
    const local = t - sound.at;
    if (!words?.length || sound.volume === 0 || local < 0 || local >= audioLength(sound)) continue;
    const shown = lineAt(linesOf(words, captions.style), sound.start + local, sound.start, sound.end, sound.mediaId);
    if (shown) return shown;
  }
  return null;
}

/**
 * A line typed over: its words replaced by the new ones. The same number of words keep their
 * times; otherwise the line's time is shared out by the words' lengths. Nothing typed removes it.
 */
export function retypeLine(words: readonly CaptionWord[], line: CaptionLine, text: string): CaptionWord[] {
  const typed = splitWords(text).map((w) => w.slice(0, 80));
  const inLine = new Set(line.words);
  const rest = words.filter((w) => !inLine.has(w));
  let replaced: CaptionWord[];
  if (typed.length === line.words.length) {
    replaced = line.words.map((w, i) => ({ ...w, text: typed[i]! }));
  } else {
    const start = line.words[0]!.start;
    const span = Math.max(0.1, line.words.at(-1)!.end - start);
    const weights = typed.map((w) => w.length + 2);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    let at = start;
    replaced = typed.map((text, i) => {
      const length = (weights[i]! / total) * span;
      const word = { text, start: at, end: at + length };
      at += length;
      return word;
    });
  }
  return [...rest, ...replaced].sort((a, b) => a.start - b.start);
}

/** A caption's words as they read, with the gaps right for scripts written without spaces. */
export const lineText = (words: readonly CaptionWord[]) => joinWords(words.map((w) => w.text));

/* ------------------------------ Auto captions ------------------------------ */

/** A part of a file's sound sent for captions: its seconds `start` to `end`, at `at` in the sound sent. */
export type SoundPiece = { mediaId: string; start: number; end: number; at: number };

/** Sound kept around each part used, so the first and last words aren't clipped. */
const PAD = 0.4;
/** Silence between pieces, so words of two pieces aren't heard as one. */
export const PIECE_GAP = 0.6;

/**
 * What to send for captions: the parts of each file the main track uses (with sound, not frozen),
 * padded and joined where they nearly touch, one after another. `total`: the sound's length.
 */
export function soundPlan(edit: Edit, hasSound: (mediaId: string) => boolean): { pieces: SoundPiece[]; total: number } {
  const byMedia = new Map<string, Range[]>();
  for (const clip of edit.clips) {
    if (clip.freeze || !hasSound(clip.mediaId)) continue;
    const media = edit.media.find((m) => m.id === clip.mediaId);
    if (!media || media.kind !== "video" && media.kind !== "audio") continue;
    const list = byMedia.get(clip.mediaId) ?? [];
    list.push({ start: Math.max(0, clip.start - PAD), end: Math.min(media.duration || clip.end, clip.end + PAD) });
    byMedia.set(clip.mediaId, list);
  }
  const pieces: SoundPiece[] = [];
  let at = 0;
  for (const [mediaId, ranges] of byMedia) {
    // Parts less than two seconds apart go as one: the gap costs less than a cut word.
    const joined = mergeRanges(ranges.map((r) => ({ start: r.start - 1, end: r.end + 1 }))).map((r) => ({ start: r.start + 1, end: r.end - 1 }));
    for (const r of joined) {
      if (r.end - r.start < 0.2) continue;
      pieces.push({ mediaId, start: r.start, end: r.end, at });
      at += r.end - r.start + PIECE_GAP;
    }
  }
  return { pieces, total: Math.max(0, at - PIECE_GAP) };
}

/** Words heard in the sound sent, back in their files' own seconds. Words in the gaps go. */
export function wordsToMedia(pieces: readonly SoundPiece[], words: readonly CaptionWord[]): Record<string, CaptionWord[]> {
  const out: Record<string, CaptionWord[]> = {};
  for (const word of words) {
    const middle = (word.start + word.end) / 2;
    const piece = pieces.find((p) => middle >= p.at && middle < p.at + (p.end - p.start));
    if (!piece) continue;
    const shift = piece.start - piece.at;
    const length = piece.end - piece.start;
    const clampIn = (t: number) => Math.min(piece.end, Math.max(piece.start, t + shift));
    (out[piece.mediaId] ??= []).push({ text: word.text, start: clampIn(word.start), end: clampIn(Math.min(word.end, piece.at + length)) });
  }
  return out;
}
