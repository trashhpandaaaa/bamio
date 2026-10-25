import type { CaptionWord } from "@/lib/clips/logic";

/*
 * Filler words: the sounds people make while they think ("um", "uh", "ehm"), and the stutter
 * where a short word is said twice in a row ("I I think", "the the"). Bamio knows when every
 * word was spoken, so cutting them is a matter of naming them.
 *
 * Only these two kinds are cut, on purpose. "Like", "you know", "basically" and the rest are
 * filler in one sentence and the point of the next, and a clipper would rather keep a word
 * than lose a meaning; a tool that guessed at them would quietly change what someone said.
 * The transcript may have no punctuation or capitals (the multilingual model writes neither),
 * so words are compared stripped and lowercased.
 */

/** Sounds that are filler in most languages as a transcriber writes them. */
const EVERYWHERE = ["um", "umm", "ummm", "uh", "uhh", "uhhh", "er", "err", "erm", "ehm", "hmm", "hm", "mmm", "mm", "ah", "ahh", "eh", "uhm", "mhm", "huh"];

/**
 * By language (the code the transcript is in, before any region). Each list is the filler
 * sounds that language's speakers make, as the models write them; EVERYWHERE is added to all.
 */
const BY_LANGUAGE: Record<string, string[]> = {
  en: ["uhhuh", "mmhmm"],
  es: ["este", "esto", "pues", "eee", "mmm"],
  pt: ["né", "tipo", "éé", "ããã"],
  fr: ["euh", "euhh", "ben", "bah", "hein"],
  de: ["äh", "ähm", "öh", "hm", "tja"],
  nl: ["eh", "ehm", "uhm", "nou"],
  it: ["ehm", "mah", "boh", "cioè"],
  pl: ["eee", "yyy", "no"],
  ru: ["ээ", "ээ", "ммм", "эм", "ну"],
  uk: ["ееє", "ем", "ну"],
  tr: ["ııı", "eee", "şey"],
  id: ["eee", "anu", "apa"],
  hi: ["मतलब", "अं", "अम"],
  bn: ["মানে", "আম"],
  ja: ["えー", "あの", "その", "えっと", "あのー", "まあ"],
  ko: ["음", "어", "그", "저기", "뭐"],
  zh: ["嗯", "呃", "那个", "就是"],
  ar: ["يعني", "اه", "امم"],
  he: ["אהה", "אמ"],
  vi: ["ờ", "ừm", "à"],
  th: ["เอ่อ", "อื้ม"],
};

/** Words short enough that saying them twice in a row is a stutter, not emphasis ("very very" stays). */
const STUTTER_MAX_CHARS = 4;

/** A word as it compares: lowercased, without punctuation or the marks around it. */
export const bareWord = (text: string) =>
  text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, "")
    .trim();

/** The filler sounds of a language (its code, or none for the shared list). */
export function fillerWords(language?: string): Set<string> {
  const code = language?.toLowerCase().split(/[-_]/)[0] ?? "";
  return new Set([...EVERYWHERE, ...(BY_LANGUAGE[code] ?? [])]);
}

export type Cut = { start: number; end: number };

/**
 * The parts of a clip that are filler, from its words: every filler sound, and the first of
 * two identical short words in a row. Times are the words' own, so they suit whatever
 * timeline the words were measured on.
 */
export function fillerCuts(words: readonly CaptionWord[], language?: string): Cut[] {
  const fillers = fillerWords(language);
  const cuts: Cut[] = [];
  const bare = words.map((w) => bareWord(w.text));
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    if (word.end <= word.start) continue;
    const text = bare[i]!;
    if (!text) continue;
    const isFiller = fillers.has(text);
    const isStutter = text.length <= STUTTER_MAX_CHARS && bare[i + 1] === text;
    if (isFiller || isStutter) cuts.push({ start: word.start, end: word.end });
  }
  return cuts;
}

/** How many words of a clip are filler, for the count the editor shows before cutting. */
export const countFillers = (words: readonly CaptionWord[], language?: string) => fillerCuts(words, language).length;
