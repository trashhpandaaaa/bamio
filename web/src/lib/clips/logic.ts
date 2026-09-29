import { LIMITS, type Aspect, type CaptionStyle, type ClipEdit, type Segment } from "@/lib/clips/schema";

/* Pure helpers shared by the browser (preview) and the server (export). */

/* ------------------------------ Time ------------------------------ */

/** h:mm:ss or m:ss, with optional hundredths. */
export function formatTimecode(seconds: number, { hundredths = false } = {}): string {
  const s = Math.max(0, seconds);
  const cs = Math.floor(s * 100 + 1e-6);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6_000);
  const sec = Math.floor((cs % 6_000) / 100);
  const frac = hundredths ? `.${String(cs % 100).padStart(2, "0")}` : "";
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}${frac}` : `${m}:${String(sec).padStart(2, "0")}${frac}`;
}

/** "1:02:03.5", "2:03", "75" or "75.5" to seconds. Null if not a valid time. */
export function parseTimecode(input: string): number | null {
  const text = input.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text)) return null;
  const parts = text.split(":");
  const last = Number.parseFloat(parts.pop()!);
  // Seconds, and minutes when hours are given, must be under 60.
  if (parts.length > 0 && last >= 60) return null;
  if (parts.length === 2 && Number.parseInt(parts[1]!, 10) >= 60) return null;
  let total = last;
  let mult = 60;
  for (const p of [...parts].reverse()) {
    total += Number.parseInt(p, 10) * mult;
    mult *= 60;
  }
  return Number.isFinite(total) ? total : null;
}

/* ---------------------------- Captions ---------------------------- */

export type CaptionWord = { text: string; start: number; end: number };
export type CaptionLine = { start: number; end: number; words: CaptionWord[] };

const WORDS_PER_LINE: Record<CaptionStyle, number> = { pop: 3, clean: 7, boxed: 6 };

/** Transcript text is stored with a space between every word, in every language. */
export const splitWords = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/**
 * Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer,
 * Burmese, Tibetan), with their punctuation. Keep in sync with workers/transcribe-core.mjs.
 */
const NO_SPACE = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}\p{scx=Tibetan}　-〿＀-￯]/u;
export const hasNoSpaceScript = (text: string) => NO_SPACE.test(text);

/** What goes between two words on screen: nothing between words of scripts written without spaces. */
export function wordGap(before: string, after: string): string {
  const last = Array.from(before).at(-1) ?? "";
  const first = Array.from(after)[0] ?? "";
  return NO_SPACE.test(last) && NO_SPACE.test(first) ? "" : " ";
}

/** Words as they read on screen. */
export const joinWords = (words: string[]) => words.reduce((text, w, i) => (i === 0 ? w : text + wordGap(words[i - 1]!, w) + w), "");

/** A transcript phrase as it reads (see splitWords). */
export const displayText = (text: string) => joinWords(splitWords(text));

const WIDE = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{Script=Hangul}　-〿！-｠]/u;

/** Rough width of text in ems: full-width (CJK) characters 1, others about half. */
export function textEm(text: string): number {
  let em = 0;
  for (const ch of text) em += WIDE.test(ch) ? 1 : /\s/.test(ch) ? 0.3 : /\p{M}/u.test(ch) ? 0 : 0.55;
  return em;
}

/**
 * The widest a caption line may be, in ems, when it can't wrap: libass only breaks lines
 * at spaces, so lines in scripts without spaces must fit the 9:16 frame on their own
 * (with room for the active word's 110%). Sizes: ASS_SIZES in ass.ts.
 */
const MAX_LINE_EM: Record<CaptionStyle, number> = { pop: 11, clean: 16, boxed: 16 };
const MAX_TITLE_EM = 17;

/**
 * A title as lines. Titles in scripts without spaces are broken at word boundaries so
 * they fit (libass can't wrap them); others stay one line and wrap at spaces.
 */
export function titleLines(title: string): string[] {
  if (!hasNoSpaceScript(title)) return [title];
  const lines: string[] = [];
  let line = "";
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "word" }).segment(title)) {
    if (line && textEm(line + segment) > MAX_TITLE_EM && !/^[\p{P}\s]+$/u.test(segment)) {
      lines.push(line.trim());
      line = "";
    }
    line += segment;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

/**
 * When each word of a phrase is spoken: the measured times when the captions were synced
 * to the audio, otherwise spread across the phrase by word length.
 */
export function segmentWordTimes(seg: Segment): CaptionWord[] {
  const texts = splitWords(seg.text);
  if (seg.words && seg.words.length === texts.length) {
    return texts.map((text, i) => ({ text, start: seg.words![i]!.start, end: seg.words![i]!.end }));
  }
  const weights = texts.map((w) => w.length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.max(0, seg.end - seg.start);
  let t = seg.start;
  return texts.map((text, i) => {
    const d = (weights[i]! / total) * span;
    const word = { text, start: t, end: t + d };
    t += d;
    return word;
  });
}

/**
 * Caption lines for the part of the transcript inside [clipStart, clipEnd], with times
 * relative to the clip (see segmentWordTimes for where word times come from).
 */
export function captionLines(segments: Segment[], clipStart: number, clipEnd: number, style: CaptionStyle): CaptionLine[] {
  const perLine = WORDS_PER_LINE[style];
  const lines: CaptionLine[] = [];
  for (const seg of segments) {
    if (seg.end <= clipStart || seg.start >= clipEnd || seg.end <= seg.start) continue;
    const words = segmentWordTimes(seg);
    if (words.length === 0) continue;
    // Keep only words that are mostly inside the clip.
    const inside = words.filter((w) => (w.start + w.end) / 2 >= clipStart && (w.start + w.end) / 2 < clipEnd);
    let chunk: CaptionWord[] = [];
    const flush = () => {
      if (chunk.length > 0) lines.push({ start: chunk[0]!.start, end: chunk.at(-1)!.end, words: chunk });
      chunk = [];
    };
    for (const w of inside) {
      const texts = [...chunk.map((c) => c.text), w.text];
      const tooWide = chunk.length > 0 && hasNoSpaceScript(w.text) && textEm(joinWords(texts)) > MAX_LINE_EM[style];
      if (chunk.length >= perLine || tooWide) flush();
      chunk.push({ text: w.text, start: Math.max(0, w.start - clipStart), end: Math.min(clipEnd, w.end) - clipStart });
    }
    flush();
  }
  return lines;
}

/** The line showing at time t (clip-relative), if any. */
export function lineAt(lines: CaptionLine[], t: number): CaptionLine | undefined {
  return lines.find((l) => t >= l.start && t < l.end);
}

/* ------------------------------ Frame ----------------------------- */

export const OUTPUT_SIZE: Record<Aspect, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "16:9": { width: 1920, height: 1080 },
};

/** Even sizes (at least 2 px) and even offsets (at least 0): x264 needs even dimensions for yuv420p. */
const evenSize = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const evenOffset = (n: number) => Math.max(0, Math.floor(n / 2) * 2);

/** The source rectangle that fills the output aspect, positioned by focusX (0 left, 1 right). */
export function cropRect(srcW: number, srcH: number, aspect: Aspect, focusX: number) {
  const { width, height } = OUTPUT_SIZE[aspect];
  const target = width / height;
  if (srcW / srcH > target) {
    const w = evenSize(srcH * target);
    const h = evenSize(srcH);
    const x = evenOffset(Math.round((srcW - w) * Math.min(1, Math.max(0, focusX))));
    return { w, h, x: Math.min(x, evenOffset(srcW - w)), y: 0 };
  }
  const w = evenSize(srcW);
  const h = evenSize(srcW / target);
  return { w, h, x: 0, y: evenOffset((srcH - h) / 2) };
}

/** Why a clip's in and out points can't be used, or null when they're fine. */
export function clipRangeError(start: number, end: number, durationSec: number): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "Enter a start and an end.";
  if (start < 0) return "The start can’t be before the video begins.";
  if (end > durationSec + 0.05) return `The end can’t be after the video ends (${formatTimecode(durationSec)}).`;
  if (end - start < LIMITS.minClipSec) return `A clip needs at least ${LIMITS.minClipSec} seconds.`;
  if (end - start > LIMITS.maxClipSec) return `A clip can be up to ${LIMITS.maxClipSec / 60} minutes long.`;
  return null;
}

/* ------------------------------ Export ----------------------------- */

/**
 * What an export is rendered from. Stored with the export; when the clip's current
 * signature differs, the file no longer matches the edit.
 */
export function exportSignature(clip: { start: number; end: number; edit: ClipEdit }, transcriptRev: number): string {
  const edit = Object.entries(clip.edit).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify([clip.start, clip.end, edit, clip.edit.captions ? transcriptRev : 0]);
}

/** The title drawn on the video, if the clip shows one. Falls back to the clip's name. */
export function overlayTitle(clip: { title: string; edit: ClipEdit }): string {
  if (!clip.edit.showTitle) return "";
  return (clip.edit.titleText.trim() || clip.title.trim()).slice(0, LIMITS.overlayTitle);
}

/** "best": AI score first (newest first among equals); "time": by position in the video. */
export function sortClips<T extends { start: number; score?: number; createdAt: number }>(clips: T[], order: "best" | "time"): T[] {
  const list = [...clips];
  if (order === "time") return list.sort((a, b) => a.start - b.start);
  return list.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.createdAt - a.createdAt);
}

/* --------------------------- AI clip cleanup --------------------------- */

export type RawClip = { start: number; end: number; title: string; reason?: string; score?: number };

/**
 * Make AI clip suggestions safe to use: inside the media, snapped to phrase
 * boundaries, within length limits, and without heavy overlaps (best score wins).
 */
export function normalizeClips(
  raw: RawClip[],
  opts: { durationSec: number; segments: Segment[]; minSec?: number; maxSec?: number; max?: number },
): RawClip[] {
  const minSec = opts.minSec ?? LIMITS.minClipSec;
  const maxSec = opts.maxSec ?? LIMITS.maxClipSec;
  const snap = (t: number, kind: "start" | "end") => {
    let best = t;
    let bestDist = 1.5;
    for (const s of opts.segments) {
      const edge = kind === "start" ? s.start : s.end;
      const dist = Math.abs(edge - t);
      if (dist < bestDist) {
        best = edge;
        bestDist = dist;
      }
    }
    return best;
  };
  const cleaned = raw
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end))
    .map((c) => {
      let start = Math.max(0, snap(c.start, "start"));
      let end = Math.min(opts.durationSec, snap(c.end, "end"));
      if (end - start > maxSec) end = start + maxSec;
      if (end - start < minSec) end = Math.min(opts.durationSec, start + minSec);
      if (end - start < minSec) start = Math.max(0, end - minSec);
      return {
        ...c,
        start: Math.round(start * 100) / 100,
        end: Math.round(end * 100) / 100,
        title: c.title.trim().slice(0, LIMITS.clipTitle) || "Untitled clip",
        score: c.score === undefined ? undefined : Math.min(100, Math.max(0, Math.round(c.score))),
      };
    })
    .filter((c) => c.end - c.start >= Math.min(minSec, opts.durationSec) - 0.01)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const kept: RawClip[] = [];
  for (const c of cleaned) {
    const overlaps = kept.some((k) => {
      const overlap = Math.min(k.end, c.end) - Math.max(k.start, c.start);
      return overlap > 0.5 * Math.min(k.end - k.start, c.end - c.start);
    });
    if (!overlaps) kept.push(c);
    if (kept.length >= (opts.max ?? LIMITS.maxClips)) break;
  }
  return kept;
}
