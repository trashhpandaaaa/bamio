/*
 * Spoken languages. Every language is transcribed on the device: English and 23 European
 * languages by NVIDIA Parakeet (with punctuation and capitals), everything else by Meta's
 * Omnilingual ASR (1,600+ languages, lowercase without punctuation). "auto" detects the
 * language from the speech (Whisper). The list below is what the pickers offer; a language
 * that isn't listed is still transcribed when it's detected.
 */

export const AUTO_LANGUAGE = "auto";

/** English names by code (ISO 639-1 where there is one). */
const NAMES: Record<string, string> = {
  af: "Afrikaans", ak: "Akan", am: "Amharic", ar: "Arabic", as: "Assamese", az: "Azerbaijani", ba: "Bashkir", be: "Belarusian",
  bg: "Bulgarian", bho: "Bhojpuri", bn: "Bengali", bo: "Tibetan", br: "Breton", bs: "Bosnian", ca: "Catalan", ceb: "Cebuano",
  ckb: "Kurdish (Sorani)", cs: "Czech", cy: "Welsh", da: "Danish", de: "German", dv: "Dhivehi", ee: "Ewe", el: "Greek", en: "English",
  es: "Spanish", et: "Estonian", eu: "Basque", fa: "Persian", ff: "Fula", fi: "Finnish", fo: "Faroese", fr: "French", ga: "Irish",
  gl: "Galician", gn: "Guarani", gu: "Gujarati", ha: "Hausa", haw: "Hawaiian", he: "Hebrew", hi: "Hindi", hr: "Croatian",
  ht: "Haitian Creole", hu: "Hungarian", hy: "Armenian", id: "Indonesian", ig: "Igbo", is: "Icelandic", it: "Italian", ja: "Japanese",
  jv: "Javanese", ka: "Georgian", kab: "Kabyle", kk: "Kazakh", km: "Khmer", kn: "Kannada", ko: "Korean", ku: "Kurdish (Kurmanji)",
  ky: "Kyrgyz", la: "Latin", lb: "Luxembourgish", lg: "Ganda", ln: "Lingala", lo: "Lao", lt: "Lithuanian", lv: "Latvian",
  mai: "Maithili", mg: "Malagasy", mi: "Māori", mk: "Macedonian", ml: "Malayalam", mn: "Mongolian", mr: "Marathi", ms: "Malay",
  mt: "Maltese", my: "Burmese", ne: "Nepali", nl: "Dutch", nn: "Norwegian Nynorsk", no: "Norwegian", ny: "Chichewa", oc: "Occitan",
  om: "Oromo", or: "Odia", pa: "Punjabi", pl: "Polish", ps: "Pashto", pt: "Portuguese", qu: "Quechua", ro: "Romanian", ru: "Russian",
  rw: "Kinyarwanda", sa: "Sanskrit", sat: "Santali", sd: "Sindhi", si: "Sinhala", sk: "Slovak", sl: "Slovenian", sn: "Shona",
  so: "Somali", sq: "Albanian", sr: "Serbian", st: "Sesotho", su: "Sundanese", sv: "Swedish", sw: "Swahili", ta: "Tamil", te: "Telugu",
  tg: "Tajik", th: "Thai", ti: "Tigrinya", tk: "Turkmen", tl: "Tagalog (Filipino)", tn: "Tswana", tr: "Turkish", tt: "Tatar",
  ug: "Uyghur", uk: "Ukrainian", ur: "Urdu", uz: "Uzbek", vi: "Vietnamese", wo: "Wolof", xh: "Xhosa", yi: "Yiddish", yo: "Yoruba",
  yue: "Cantonese", zh: "Chinese", zu: "Zulu",
};

/** The picker's choices: detect automatically, then every listed language by name. */
export const LANGUAGE_OPTIONS: { code: string; name: string }[] = Object.entries(NAMES)
  .map(([code, name]) => ({ code, name }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

/** A language's English name ("hi" -> "Hindi"); unlisted codes are named by the browser or shown as is. */
export function languageName(code: string | undefined): string {
  if (!code || code === AUTO_LANGUAGE || code === "other") return "Detect automatically";
  const base = code.toLowerCase();
  if (NAMES[base]) return NAMES[base];
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** "auto" for automatic detection (older projects saved "other" for that). */
export const isAutoLanguage = (code: string | undefined) => !code || code === AUTO_LANGUAGE || code === "other";

/** What Parakeet transcribes: English and 23 European languages (keep in sync with EUROPEAN in workers/transcribe-core.mjs). */
export const PARAKEET_LANGUAGES = new Set(
  ["en", "bg", "hr", "cs", "da", "nl", "et", "fi", "fr", "de", "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk"],
);

/** True when Meta's multilingual model transcribes the language (everything Parakeet doesn't). */
export const usesMultilingualModel = (code: string | undefined) => !isAutoLanguage(code) && !PARAKEET_LANGUAGES.has(code!.toLowerCase().split("-")[0]!);
