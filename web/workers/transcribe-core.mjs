/*
 * The pure parts of workers/transcribe.mjs, kept separate so they can be unit tested
 * without the speech models: turning recognizer tokens into timed words, words into
 * caption phrases, and which model transcribes which language.
 */

/** The longest a word is shown, from its length: longer words take longer to say. */
export const maxWordSec = (text) => Math.min(2, 0.4 + 0.08 * text.length);

const round = (n) => Math.round(n * 1000) / 1000;

/**
 * Scripts written without spaces between words (Chinese, Japanese, Thai, Lao, Khmer,
 * Burmese, Tibetan), with their punctuation. Keep in sync with NO_SPACE in src/lib/clips/logic.ts.
 */
export const NO_SPACE = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}\p{scx=Tibetan}　-〿＀-￯]/u;

/**
 * Japanese: dictionary word breaks cut verbs and endings into single kana (言|っ|た), so
 * hiragana after a word with kanji or katakana joins it (言った, 行きましょう, 天気です),
 * as do one-kana particles (みんな|で -> みんなで), up to 8 characters.
 */
const HIRAGANA_ONLY = /^\p{Script=Hiragana}+$/u;
const JA_PARTICLE = /^[はがをにでとのもへやかねよな]$/u;
const HAS_KANJI_OR_KATAKANA = /[\p{Script=Han}\p{Script=Katakana}]/u;
const ENDS_IN_PUNCTUATION = /\p{P}$/u;
const joinsJapanese = (prev, piece) =>
  HIRAGANA_ONLY.test(piece) &&
  !ENDS_IN_PUNCTUATION.test(prev) &&
  (JA_PARTICLE.test(piece) || HAS_KANJI_OR_KATAKANA.test(prev)) &&
  [...prev].length + [...piece].length <= 8;

const segmenters = new Map();
function wordSegmenter(locale) {
  const key = locale ?? "";
  if (!segmenters.has(key)) {
    let seg;
    try {
      seg = new Intl.Segmenter(locale || undefined, { granularity: "word" });
    } catch {
      seg = new Intl.Segmenter(undefined, { granularity: "word" });
    }
    segmenters.set(key, seg);
  }
  return segmenters.get(key);
}

/**
 * Split text into caption words, each with its offset in `text`: at spaces, and inside
 * runs of scripts written without spaces at dictionary word boundaries. Punctuation stays
 * with the word before it (or the one after, at the start).
 *
 * @param {string} text
 * @param {string} [locale]  the spoken language, e.g. "ja"
 * @returns {{ text: string, index: number }[]}
 */
export function splitIntoWords(text, locale) {
  /** @type {{ text: string, index: number }[]} */
  const out = [];
  for (const m of text.matchAll(/\S+/gu)) {
    const chunk = m[0];
    const base = m.index ?? 0;
    if (!NO_SPACE.test(chunk)) {
      out.push({ text: chunk, index: base });
      continue;
    }
    const first = out.length;
    let prefix = null;
    for (const s of wordSegmenter(locale).segment(chunk)) {
      const piece = s.segment;
      const prev = out.length > first ? out[out.length - 1] : null;
      if (!s.isWordLike) {
        if (prev) prev.text += piece;
        else prefix = prefix ? { text: prefix.text + piece, index: prefix.index } : { text: piece, index: base + s.index };
        continue;
      }
      if (prev && joinsJapanese(prev.text, piece)) {
        prev.text += piece;
        continue;
      }
      out.push(prefix ? { text: prefix.text + piece, index: prefix.index } : { text: piece, index: base + s.index });
      prefix = null;
    }
    if (prefix) out.push(prefix);
  }
  return out;
}

/**
 * Timed words from one recognizer result. Tokens are word pieces (Parakeet: a leading
 * space or "▁" starts a word) or single characters with a space token between words
 * (Omnilingual). Each word starts at the time of the token holding its first character,
 * and ends when the next one starts, when its speech segment ends, or after a reasonable
 * time for its length, whichever is first.
 *
 * @param {string[]} tokens
 * @param {number[]} times  token start times in seconds from the start of the segment
 * @param {number} segStart  the segment's start in the video, seconds
 * @param {number} segEnd  the segment's end in the video, seconds
 * @param {string} [locale]  the spoken language, for word boundaries in scripts without spaces
 * @returns {{ text: string, start: number, end: number }[]}
 */
export function tokensToWords(tokens, times, segStart, segEnd, locale) {
  let text = "";
  /** @type {number[]} the time of each UTF-16 unit of `text` */
  const charTimes = [];
  tokens.forEach((token, k) => {
    const piece = token.replace(/▁/g, " ");
    for (let i = 0; i < piece.length; i++) charTimes.push(Math.max(0, times[k] ?? 0));
    text += piece;
  });
  const words = splitIntoWords(text, locale).map((w) => ({ text: w.text, start: segStart + (charTimes[w.index] ?? 0) }));
  return words.map((w, i) => {
    const next = i + 1 < words.length ? words[i + 1].start : segEnd;
    const end = Math.max(w.start + 0.05, Math.min(next, segEnd, w.start + maxWordSec(w.text)));
    return { text: w.text, start: round(w.start), end: round(end) };
  });
}

/** Punctuation that ends a sentence, and punctuation that marks a natural break, in many scripts. */
const SENTENCE_END = /[.!?…。！？।॥؟۔։።]["')\]»”’」』）]*$/u;
const SOFT_BREAK = /[,;:、，；：،؛]["')\]»”’」』）]*$/u;

/**
 * Group words into caption phrases: break after a sentence, at a pause, or at a comma
 * once the phrase has some length, and never let a phrase run past 14 words. Words are
 * joined with spaces (also in scripts written without them: the captions leave those out).
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

/* --------------------------- Indian scripts --------------------------- */

/** The Unicode blocks of the main Indian scripts: 128 code points each, in one shared layout. */
const INDIC_BLOCKS = { Devanagari: 0x900, Bengali: 0x980, Gurmukhi: 0xa00, Gujarati: 0xa80, Oriya: 0xb00, Tamil: 0xb80, Telugu: 0xc00, Kannada: 0xc80, Malayalam: 0xd00 };
const INDIC_LANGUAGES = {
  hi: "Devanagari", mr: "Devanagari", ne: "Devanagari", sa: "Devanagari", mai: "Devanagari", bho: "Devanagari", awa: "Devanagari", mag: "Devanagari", kok: "Devanagari", doi: "Devanagari",
  bn: "Bengali", as: "Bengali", pa: "Gurmukhi", gu: "Gujarati", or: "Oriya", ta: "Tamil", te: "Telugu", kn: "Kannada", ml: "Malayalam",
};
const blockOf = (cp) => Object.entries(INDIC_BLOCKS).find(([, base]) => cp >= base && cp < base + 0x80)?.[0];
const SHARED = new Set([0x64, 0x65]); // danda and double danda, used by several scripts
/** Letters a script lacks, by offset: what that script writes instead ("" drops it). Bengali writes va as ba. */
const INSTEAD = { Bengali: { 0x35: 0x2c, 0x11: 0x05, 0x49: "" } };

/**
 * Omnilingual isn't told the language, and sometimes writes letters of a neighbouring
 * Indian script (Bengali speech partly in Devanagari). The scripts share one layout, so
 * those letters map back exactly. The script is the language's, or else the one most of
 * the text is in (when it's clearly most). Returns a function that fixes one text.
 *
 * @param {string[]} texts  the whole transcript, to find the main script
 * @param {string} [language]
 * @returns {(text: string) => string}
 */
export function indicScriptFixer(texts, language) {
  let target = INDIC_LANGUAGES[String(language ?? "").toLowerCase().split("-")[0]];
  if (!target) {
    const counts = {};
    let total = 0;
    for (const t of texts) {
      for (const ch of t) {
        const b = blockOf(ch.codePointAt(0));
        if (b) {
          counts[b] = (counts[b] ?? 0) + 1;
          total++;
        }
      }
    }
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (!top || n < total * 0.6) return (t) => t;
    target = top;
  }
  const base = INDIC_BLOCKS[target];
  const inTarget = new RegExp(`\\p{Script=${target}}`, "u");
  const instead = INSTEAD[target] ?? {};
  return (text) => {
    let out = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      const b = blockOf(cp);
      if (!b || b === target || SHARED.has(cp & 0x7f)) {
        out += ch;
        continue;
      }
      const offset = cp & 0x7f;
      const mapped = String.fromCodePoint(base + offset);
      if (inTarget.test(mapped)) out += mapped;
      else if (offset in instead) out += instead[offset] === "" ? "" : String.fromCodePoint(base + instead[offset]);
      else out += ch;
    }
    return out;
  };
}

/* ------------------------------ Engines ------------------------------ */

/**
 * The 24 languages besides English that NVIDIA Parakeet TDT 0.6B v3 transcribes (with
 * punctuation and capitals). English has its own model; everything else goes to Meta's
 * Omnilingual ASR, which covers 1,600+ languages.
 */
export const EUROPEAN = new Set(["bg", "hr", "cs", "da", "nl", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk"]);

/** Which model transcribes a language: "english", "european" or "omni". */
export function engineFor(language) {
  const base = String(language ?? "").toLowerCase().split("-")[0];
  if (base === "en") return "english";
  if (EUROPEAN.has(base)) return "european";
  return "omni";
}
