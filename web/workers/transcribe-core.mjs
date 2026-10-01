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

/** Markers such as "<unk>" (a sound the model has no letter for) aren't text. */
const SPECIAL_TOKEN = /^<\/?[a-z_]+>$/i;
const MARK = /^\p{M}/u;

/**
 * Timed words from one recognizer result. Tokens are word pieces (Parakeet: a leading
 * space or "▁" starts a word) or single characters with a space token between words
 * (Omnilingual). Each word starts at the time of the token holding its first character,
 * and ends when the next one starts, when its speech segment ends, or after a reasonable
 * time for its length, whichever is first. Markers are dropped, and so are vowel signs
 * and accents that would start a word (the multilingual model sometimes puts a space
 * before one; alone they show as a dotted circle).
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
    if (SPECIAL_TOKEN.test(token.trim())) return;
    for (const ch of token.replace(/▁/g, " ")) {
      if (MARK.test(ch) && (text === "" || /\s$/u.test(text))) continue;
      for (let i = 0; i < ch.length; i++) charTimes.push(Math.max(0, times[k] ?? 0));
      text += ch;
    }
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
 * those letters map back exactly. The target is the script most of the text is in; the
 * language only decides when no script clearly leads (and it's well represented), because
 * language detection can be wrong (Nepali once came back as Malayalam, and every Devanagari
 * letter was turned into Malayalam). Returns a function that fixes one text.
 *
 * @param {string[]} texts  the whole transcript, to find the main script
 * @param {string} [language]
 * @returns {(text: string) => string}
 */
export function indicScriptFixer(texts, language) {
  const wanted = INDIC_LANGUAGES[String(language ?? "").toLowerCase().split("-")[0]];
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
  let target = null;
  if (total === 0) target = wanted ?? null;
  else if (top && n >= total * 0.6) target = top;
  else if (wanted && (counts[wanted] ?? 0) >= total * 0.3) target = wanted;
  if (!target) return (t) => t;
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
    return tidyIndic(out);
  };
}

const isVowelSign = (cp) => blockOf(cp) !== undefined && (cp & 0x7f) >= 0x3e && (cp & 0x7f) <= 0x4c;
const isVirama = (cp) => blockOf(cp) !== undefined && (cp & 0x7f) === 0x4d;

/**
 * Letter sequences no word has, which the multilingual model sometimes writes and which
 * fonts show with a dotted circle: a vowel sign after a virama (the virama goes) or after
 * another vowel sign (the second goes; two-part vowels such as Bengali ো are one letter once
 * composed).
 */
export function tidyIndic(text) {
  let out = "";
  let prev = 0;
  for (const ch of text.normalize("NFC")) {
    const cp = ch.codePointAt(0);
    if (isVowelSign(cp) && isVowelSign(prev)) continue;
    if (isVowelSign(cp) && isVirama(prev)) out = out.slice(0, -1);
    out += ch;
    prev = cp;
  }
  return out;
}

/* ----------------------- Scripts and code-switching ----------------------- */

/** Writing systems told apart; Japanese kana count as Han (they're written together). */
const SCRIPTS = [
  "Latin", "Devanagari", "Bengali", "Gurmukhi", "Gujarati", "Oriya", "Tamil", "Telugu", "Kannada", "Malayalam", "Sinhala",
  "Arabic", "Hebrew", "Thai", "Lao", "Khmer", "Myanmar", "Tibetan", "Georgian", "Armenian", "Ethiopic", "Cyrillic", "Greek",
  "Han", "Hiragana", "Katakana", "Hangul",
].map((name) => [name, new RegExp(`\\p{Script=${name}}`, "u")]);
const GROUP = { Hiragana: "Han", Katakana: "Han" };

/** The script of a letter (or vowel sign), or null for digits, punctuation and spaces. */
export function scriptOf(ch) {
  if (!/[\p{L}\p{M}]/u.test(ch)) return null;
  for (const [name, re] of SCRIPTS) if (re.test(ch)) return GROUP[name] ?? name;
  return "Other";
}

/** Letters per script in `text`. */
export function scriptCounts(text) {
  const counts = {};
  for (const ch of text) {
    const s = scriptOf(ch);
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}

/** The share of `text`'s letters written in `script` (1 when it has no letters). */
export function scriptShare(text, script) {
  const counts = scriptCounts(text);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return total ? (counts[script] ?? 0) / total : 1;
}

/**
 * The script a transcript's language is written in: the leading script other than Latin
 * when it has at least a tenth of the letters (a podcast mostly in English with Nepali
 * parts is Devanagari: the multilingual model doesn't write a tenth of it in a script by
 * chance), else the leading one. Null without letters.
 */
export function mainScript(texts) {
  const counts = {};
  let total = 0;
  for (const t of texts) {
    for (const [s, n] of Object.entries(scriptCounts(t))) {
      counts[s] = (counts[s] ?? 0) + n;
      total += n;
    }
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const nonLatin = ranked.find(([s]) => s !== "Latin" && s !== "Other");
  if (nonLatin && nonLatin[1] >= total * 0.1) return nonLatin[0];
  return ranked[0]?.[0] ?? null;
}

const normWord = (w) => w.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");

/** Latin letters for the Indian scripts' shared layout (by offset in the block; consonants without their inherent vowel). */
const INDIC_LATIN = {
  0x01: "n", 0x02: "n", 0x03: "h", 0x05: "a", 0x06: "a", 0x07: "i", 0x08: "i", 0x09: "u", 0x0a: "u", 0x0b: "ri", 0x0d: "e", 0x0e: "e", 0x0f: "e",
  0x10: "ai", 0x11: "o", 0x12: "o", 0x13: "o", 0x14: "au", 0x15: "k", 0x16: "kh", 0x17: "g", 0x18: "gh", 0x19: "ng", 0x1a: "ch", 0x1b: "chh",
  0x1c: "j", 0x1d: "jh", 0x1e: "ny", 0x1f: "t", 0x20: "th", 0x21: "d", 0x22: "dh", 0x23: "n", 0x24: "t", 0x25: "th", 0x26: "d", 0x27: "dh",
  0x28: "n", 0x29: "n", 0x2a: "p", 0x2b: "f", 0x2c: "b", 0x2d: "bh", 0x2e: "m", 0x2f: "y", 0x30: "r", 0x31: "r", 0x32: "l", 0x33: "l", 0x34: "l",
  0x35: "v", 0x36: "sh", 0x37: "sh", 0x38: "s", 0x39: "h", 0x3e: "a", 0x3f: "i", 0x40: "i", 0x41: "u", 0x42: "u", 0x43: "ri", 0x45: "e", 0x46: "e",
  0x47: "e", 0x48: "ai", 0x49: "o", 0x4a: "o", 0x4b: "o", 0x4c: "au", 0x58: "q", 0x59: "kh", 0x5a: "g", 0x5b: "z", 0x5c: "r", 0x5d: "rh", 0x5e: "f", 0x5f: "y",
};

/** A word in Latin letters, roughly: letters of the Indian scripts spelled out, other scripts left out. */
export function romanize(word) {
  let out = "";
  for (const ch of word.normalize("NFC")) {
    const cp = ch.codePointAt(0);
    const offset = cp & 0x7f;
    if (blockOf(cp)) out += offset >= 0x66 && offset <= 0x6f ? String(offset - 0x66) : (INDIC_LATIN[offset] ?? "");
    else if (/[\p{Script=Latin}\p{N}]/u.test(ch)) out += ch;
  }
  return normWord(out);
}

/** Edit distance between two short strings. */
function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** A word with Latin letters and letters (or vowel signs) of another script. */
const isMixedWord = (w) => /\p{Script=Latin}/u.test(w) && /[\p{L}\p{M}]/u.test(w.replace(/[\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/gu, ""));

/**
 * Where two transcripts of the same speech agree, word by word (longest common
 * subsequence of normalized words): `matched[i]` for each word of `a`, and the share of
 * words that agree (of the longer transcript). On English speech the multilingual and the
 * English model write the same words; on another language written in Latin letters
 * ("lakiate kantiwa" for Nepali) the English model hears different words. A word of `a`
 * written in two scripts at once (the multilingual model unsure of the language:
 * "gिve", "पackेd") agrees with a close enough spelling ("give", "packed"); others must match.
 *
 * @param {string[]} a  the multilingual model's words
 * @param {string[]} b  the English model's words
 */
export function wordAgreement(a, b) {
  const x = a.map(normWord);
  const y = b.map(normWord);
  const loose = a.map((w) => (isMixedWord(w) ? romanize(w) : null));
  const same = (i, j) => {
    if (!x[i]) return false;
    if (x[i] === y[j]) return true;
    const r = loose[i];
    return r !== null && r.length >= 3 && levenshtein(r, y[j]) <= 0.4 * Math.max(r.length, y[j].length);
  };
  const W = y.length + 1;
  const dp = new Uint16Array((x.length + 1) * W);
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      dp[i * W + j] = same(i - 1, j - 1) ? dp[(i - 1) * W + j - 1] + 1 : Math.max(dp[(i - 1) * W + j], dp[i * W + j - 1]);
    }
  }
  const matched = new Array(x.length).fill(false);
  for (let i = x.length, j = y.length; i > 0 && j > 0; ) {
    if (same(i - 1, j - 1) && dp[i * W + j] === dp[(i - 1) * W + j - 1] + 1) {
      matched[i - 1] = true;
      i--;
      j--;
    } else if (dp[(i - 1) * W + j] >= dp[i * W + j - 1]) i--;
    else j--;
  }
  const count = dp[x.length * W + y.length];
  return { matched, ratio: count / Math.max(1, x.length, y.length) };
}

/**
 * The stretches of a segment that are English: runs of at least `minRun` words the two
 * models agree on (with the gaps of one word inside a run allowed), as time spans.
 *
 * @param {{ start: number, end: number }[]} words  the multilingual model's words
 * @param {boolean[]} matched  from wordAgreement
 */
export function englishSpans(words, matched, minRun = 3) {
  const spans = [];
  let i = 0;
  while (i < words.length) {
    if (!matched[i]) {
      i++;
      continue;
    }
    let j = i;
    let agreed = 0;
    while (j < words.length && (matched[j] || (matched[j + 1] && j + 1 < words.length))) {
      if (matched[j]) agreed++;
      j++;
    }
    if (agreed >= minRun) spans.push({ start: words[i].start, end: words[j - 1].end });
    i = j;
  }
  return spans;
}

/**
 * Common words of languages that share a script, to name the language from its transcript
 * when detection disagrees with the script (Whisper tiny once called Nepali "Malayalam").
 */
const STOPWORDS = {
  Devanagari: {
    ne: "छ छन् हो हुन्छ पनि अनि छैन त्यो यो मा लाई को ले भन्ने गर्न गर्दा भनेर थियो हुँदा चाहिँ हामी तपाईं",
    hi: "है हैं और की का के नहीं में से था थे हम आप यह वह क्या तो भी को पर",
    mr: "आहे आणि नाही हे ते मी तू काय होते आम्ही तुम्ही ला ची चा",
  },
  Arabic: {
    ar: "في من على إلى هذا التي الذي أن كان عن مع هو هي",
    fa: "است این که را با از می هم برای آن شده ما",
    ur: "ہے ہیں کے کی کا اور میں نہیں یہ وہ سے کو",
  },
  Bengali: { bn: "এবং না এই যে কি আমি আমার করে হয় তার", as: "আৰু নহয় এই মই কৰা হয় তেওঁ" },
};

/** The script languages written in one other than Latin use (the Indian ones, and the other common ones the multilingual model transcribes). */
const LANGUAGE_SCRIPT = {
  ...INDIC_LANGUAGES,
  ...Object.fromEntries(["ar", "fa", "ur", "ps", "sd", "ug", "ckb"].map((l) => [l, "Arabic"])),
  ...Object.fromEntries(["be", "mk", "kk", "ky", "mn", "tg", "tt", "ba"].map((l) => [l, "Cyrillic"])),
  zh: "Han", yue: "Han", ja: "Han", ko: "Hangul", th: "Thai", lo: "Lao", km: "Khmer", my: "Myanmar", bo: "Tibetan",
  ka: "Georgian", hy: "Armenian", am: "Ethiopic", ti: "Ethiopic", he: "Hebrew", yi: "Hebrew", si: "Sinhala",
};

/** The script a language is written in, if it's one of those above (else it's Latin or unknown). */
export const scriptOfLanguage = (language) => LANGUAGE_SCRIPT[String(language ?? "").toLowerCase().split("-")[0]] ?? null;

/**
 * The spoken language to report for a detected one. Whisper tiny mixes up languages that
 * share a script (Nepali, Hindi, Marathi) and sometimes names one of another script
 * altogether, so the transcript's own common words decide: a language written in another
 * script is replaced by the one whose common words appear most (else the script's main
 * language), and one of the same script by another whose common words clearly outnumber its own.
 *
 * @param {string} detected
 * @param {string|null} script  mainScript of the transcript
 * @param {string[]} texts
 */
export function languageForScript(detected, script, texts) {
  const table = STOPWORDS[script ?? ""];
  const sameScript = LANGUAGE_SCRIPT[detected] === script;
  if (!script || (!table && sameScript)) return detected;
  const words = texts.join(" ").split(/\s+/);
  const hits = Object.entries(table ?? {}).map(([lang, list]) => {
    const set = new Set(list.split(" "));
    return [lang, words.filter((w) => set.has(w)).length];
  });
  const [best, n] = hits.sort((a, b) => b[1] - a[1])[0] ?? [];
  if (sameScript) return best !== detected && n >= 5 && n >= 2 * (hits.find(([lang]) => lang === detected)?.[1] ?? 0) ? best : detected;
  if (best && n > 0) return best;
  return Object.entries(LANGUAGE_SCRIPT).find(([, s]) => s === script)?.[0] ?? detected;
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

/**
 * The model and language for a video from the language heard at several points (weight:
 * seconds of speech). English when at least 70% of it is (one stray guess on music or an
 * accent doesn't count). Otherwise the other languages decide between the European model
 * (which knows English too) and the multilingual one, whichever has more weight, the
 * European one on a tie; its heaviest language names the video. A mix of English and, say,
 * Nepali goes to the multilingual model, whose transcript is then repaired stretch by
 * stretch (English where it's English).
 *
 * @param {{ lang: string, weight: number }[]} windows
 * @returns {{ engine: "english" | "european" | "omni", language: string }}
 */
export function engineForWindows(windows) {
  const weight = (list) => list.reduce((sum, w) => sum + w.weight, 0);
  const heaviest = (list) => {
    const totals = new Map();
    for (const w of list) totals.set(w.lang, (totals.get(w.lang) ?? 0) + w.weight);
    return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  };
  const english = windows.filter((w) => w.lang === "en");
  if (windows.length === 0 || weight(english) >= weight(windows) * 0.7) return { engine: "english", language: "en" };
  const european = windows.filter((w) => EUROPEAN.has(w.lang));
  const omni = windows.filter((w) => w.lang !== "en" && !EUROPEAN.has(w.lang));
  if (weight(european) >= weight(omni)) return { engine: "european", language: heaviest(european) };
  return { engine: "omni", language: heaviest(omni) };
}
