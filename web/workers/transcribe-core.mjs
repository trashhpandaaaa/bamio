/*
 * The pure parts of workers/transcribe.mjs, kept separate so they can be unit tested
 * without the speech model: turning recognizer tokens into timed words, and words into
 * caption phrases.
 */

/** The longest a word is shown, from its length: longer words take longer to say. */
export const maxWordSec = (text) => Math.min(2, 0.4 + 0.08 * text.length);

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Timed words from one recognizer result. A token that starts with a space (or the
 * SentencePiece marker) begins a word; other tokens (word pieces, punctuation) join the
 * word before. A word ends when the next one starts, when its speech segment ends, or
 * after a reasonable time for its length, whichever is first.
 *
 * @param {string[]} tokens
 * @param {number[]} times  token start times in seconds from the start of the segment
 * @param {number} segStart  the segment's start in the video, seconds
 * @param {number} segEnd  the segment's end in the video, seconds
 * @returns {{ text: string, start: number, end: number }[]}
 */
export function tokensToWords(tokens, times, segStart, segEnd) {
  /** @type {{ text: string, start: number, end: number }[]} */
  const words = [];
  tokens.forEach((token, k) => {
    const text = token.replace(/^[\s▁]+/, "");
    if (!text) return;
    const startsWord = words.length === 0 || /^[\s▁]/.test(token);
    if (startsWord) {
      const start = segStart + Math.max(0, times[k] ?? 0);
      words.push({ text, start, end: start });
    } else {
      words[words.length - 1].text += text;
    }
  });
  return words.map((w, i) => {
    const next = i + 1 < words.length ? words[i + 1].start : segEnd;
    const end = Math.max(w.start + 0.05, Math.min(next, segEnd, w.start + maxWordSec(w.text)));
    return { text: w.text, start: round(w.start), end: round(end) };
  });
}

/** Punctuation that ends a sentence, and punctuation that marks a natural break. */
const SENTENCE_END = /[.!?…]["')\]»”’]*$/;
const SOFT_BREAK = /[,;:]["')\]»”’]*$/;

/**
 * Group words into caption phrases: break after a sentence, at a pause, or at a comma
 * once the phrase has some length, and never let a phrase run past 14 words.
 *
 * @param {{ text: string, start: number, end: number }[]} words  in time order
 * @returns {{ start: number, end: number, text: string, words: { start: number, end: number }[] }[]}
 */
export function wordsToPhrases(words) {
  /** @type {{ text: string, start: number, end: number }[][]} */
  const groups = [];
  let current = [];
  words.forEach((word, i) => {
    const prev = words[i - 1];
    if (prev && current.length > 0) {
      const pause = word.start - prev.end > 0.5;
      const sentence = SENTENCE_END.test(prev.text) && current.length >= 2;
      const comma = SOFT_BREAK.test(prev.text) && current.length >= 6;
      if (pause || sentence || comma || current.length >= 14) {
        groups.push(current);
        current = [];
      }
    }
    current.push(word);
  });
  if (current.length > 0) groups.push(current);
  return groups.map((g) => ({
    start: g[0].start,
    end: g[g.length - 1].end,
    text: g.map((w) => w.text).join(" "),
    words: g.map((w) => ({ start: w.start, end: w.end })),
  }));
}
