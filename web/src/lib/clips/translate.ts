import { hasNoSpaceScript, splitWords } from "@/lib/clips/logic";
import type { Segment, Transcript } from "@/lib/clips/schema";

/*
 * Captions in another language (Pro). A translated transcript keeps every phrase's own start
 * and end, measured from the audio, and drops the per-word times: a translation doesn't keep
 * a sentence's words in the same order or the same number, so there is nothing to carry them
 * on to. The words of a phrase are then spread across it by length (segmentWordTimes in
 * logic.ts does that already for any phrase without word times), which is why the pricing page
 * promises the timing of every line and not of every word.
 *
 * Everything here is pure: the request to the model is lib/ai/server/translate-ai.ts.
 */

/** Phrases per request. Enough to give the model context, small enough to come back whole. */
export const TRANSLATE_BATCH = 60;

/** The phrases to translate, in batches, each remembering where it starts in the transcript. */
export function translationBatches(segments: readonly Segment[], perBatch = TRANSLATE_BATCH): { from: number; texts: string[] }[] {
  const out: { from: number; texts: string[] }[] = [];
  for (let from = 0; from < segments.length; from += perBatch) {
    out.push({ from, texts: segments.slice(from, from + perBatch).map((s) => s.text) });
  }
  return out;
}

/**
 * Transcript text keeps a space between every word, in every language (the caption editor
 * edits them as units, and captionLines counts them). A translation into Chinese, Japanese,
 * Thai and the rest comes back without spaces, so its words are found the way the
 * transcriber finds them: with the ICU dictionaries behind Intl.Segmenter.
 */
export function spaceWords(text: string, language: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || !hasNoSpaceScript(clean)) return clean;
  const words: string[] = [];
  for (const { segment } of new Intl.Segmenter(localeOf(language), { granularity: "word" }).segment(clean)) {
    const word = segment.trim();
    if (word) words.push(word);
  }
  return words.join(" ") || clean;
}

/** A language code Intl understands, or undefined to let it choose. */
const localeOf = (language: string) => {
  try {
    return new Intl.Locale(language).toString();
  } catch {
    return undefined;
  }
};

/**
 * The transcript in `language`: the same phrases at the same times, with their text replaced.
 * A phrase whose translation came back empty keeps its own words, so nothing silently
 * disappears from a caption; loudness is kept, since it is about the audio, not the words.
 */
export function applyTranslation(transcript: Transcript, texts: readonly string[], language: string): Transcript {
  const segments = transcript.segments.map((seg, i) => {
    const translated = spaceWords(texts[i] ?? "", language);
    const text = translated || seg.text;
    return { start: seg.start, end: seg.end, text: text.slice(0, 2000) };
  });
  return { language, segments, ...(transcript.loudness ? { loudness: transcript.loudness } : {}) };
}

/** A rough check that a translation is one: as many phrases, and not simply the same words back. */
export function translationLooksDone(before: readonly Segment[], after: readonly Segment[]): boolean {
  if (after.length !== before.length || after.length === 0) return false;
  const same = after.filter((seg, i) => seg.text.trim() === before[i]!.text.trim()).length;
  return same < after.length;
}

/** How many words a translated transcript came back with, for the log. */
export const wordCount = (segments: readonly Segment[]) => segments.reduce((n, s) => n + splitWords(s.text).length, 0);
