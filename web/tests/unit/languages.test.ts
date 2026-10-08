import { describe, expect, it } from "vitest";
import {
  asSentence,
  engineFor,
  engineForWindows,
  EUROPEAN,
  englishLook,
  englishSpans,
  englishStretches,
  indicScriptFixer,
  languageForScript,
  looksEnglish,
  mainScript,
  preferOtherReading,
  romanize,
  scriptOf,
  scriptOfLanguage,
  scriptShare,
  splitIntoWords,
  splitLongSpeech,
  tidyIndic,
  tokensToWords,
  wordAgreement,
  wordsToPhrases,
} from "../../workers/transcribe-core.mjs";
import { buildAss } from "@/lib/clips/ass";
import { languageName, PARAKEET_LANGUAGES, usesMultilingualModel } from "@/lib/clips/languages";
import { retranscribeReason, TRANSCRIBER_VERSION } from "@/lib/clips/schema";
import { captionLines, displayText, joinWords, textEm, titleLines, wordGap } from "@/lib/clips/logic";
import { assMarkup, captionFontCss, captionFontOrder, fontRuns, fontsNeeded } from "@/lib/server/caption-fonts";

const texts = (words: { text: string }[]) => words.map((w) => w.text);

describe("words in any language", () => {
  it("splits at spaces, and inside scripts written without them at word boundaries", () => {
    expect(texts(splitIntoWords("नमस्ते दोस्तों, आज हम", "hi"))).toEqual(["नमस्ते", "दोस्तों,", "आज", "हम"]);
    expect(texts(splitIntoWords("我们今天来聊一聊人工智能的发展。", "zh"))).toEqual(["我们", "今天", "来", "聊", "一", "聊", "人工", "智能", "的", "发展。"]);
    expect(texts(splitIntoWords("สวัสดีครับ วันนี้", "th"))).toEqual(["สวัสดี", "ครับ", "วัน", "นี้"]);
  });

  it("keeps Japanese endings and particles with their word", () => {
    expect(texts(splitIntoWords("天気ですね、みんなで公園に行きましょう。", "ja"))).toEqual(["天気ですね、", "みんなで", "公園に", "行きましょう。"]);
    expect(texts(splitIntoWords("彼は言った iPhone 15を買った", "ja"))).toEqual(["彼は", "言った", "iPhone", "15を", "買った"]);
  });

  it("times words from character tokens (Omnilingual) and from word pieces (Parakeet)", () => {
    const chars = tokensToWords(["h", "o", "l", "a", " ", "m", "u", "n", "d", "o"], [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5], 10, 11);
    expect(chars).toEqual([
      { text: "hola", start: 10, end: 10.3 },
      { text: "mundo", start: 10.3, end: 11 },
    ]);
    const ja = tokensToWords(["今", "日", "は", " ", "天", "気"], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6], 10, 12, "ja");
    expect(ja.map((w) => [w.text, w.start])).toEqual([
      ["今日は", 10.1],
      ["天気", 10.5],
    ]);
  });

  it("ends phrases at full stops in other scripts", () => {
    const w = (text: string, start: number) => ({ text, start, end: start + 0.2 });
    expect(wordsToPhrases([w("今日は", 0), w("晴れ。", 0.3), w("明日は", 0.6)]).map((p) => p.text)).toEqual(["今日は 晴れ。", "明日は"]);
    expect(wordsToPhrases([w("यह", 0), w("है।", 0.3), w("और", 0.6)]).map((p) => p.text)).toEqual(["यह है।", "और"]);
  });

  it("maps letters written in a neighbouring Indian script back to the language's own", () => {
    expect(indicScriptFixer([], "bn")("প্রडিউসার ভवোর")).toBe("প্রডিউসার ভবোর");
    expect(indicScriptFixer([], "hi")("नमस्ते")).toBe("नमस्ते");
    // Unknown language: the script most of the text is in.
    expect(indicScriptFixer(["বাংলা ভাষা কথা", "ड"])("ड")).toBe("ড");
    expect(indicScriptFixer(["hello"])("ड")).toBe("ड");
  });

  it("sends each language to its model", () => {
    expect([engineFor("en"), engineFor("en-GB"), engineFor("es"), engineFor("uk"), engineFor("hi"), engineFor("ja"), engineFor("xyz")]).toEqual([
      "english",
      "english",
      "european",
      "european",
      "omni",
      "omni",
      "omni",
    ]);
    // Greek is one of the European model's languages, but it can't write a final sigma.
    expect(engineFor("el")).toBe("omni");
    expect(EUROPEAN.size).toBe(23);
  });

  it("keeps the main script when detection names a language of another (Nepali heard as Malayalam)", () => {
    expect(indicScriptFixer(["मलाई धेरै भिडियो हेर्न गाहरो पर्छ", "ക"], "ml")("നമസ്തേ")).toBe("नमस्ते");
    expect(indicScriptFixer(["মলাই"], "ne")("মলাই")).toBe("মলাই");
  });

  it("tidies vowel signs no word has", () => {
    expect(tidyIndic("तमान्ोुक")).toBe("तमानोक");
    expect(tidyIndic("गर्देो")).toBe("गर्दे");
    expect(tidyIndic("त्यो भिडियो")).toBe("त्यो भिडियो");
    // Bengali ো written in two parts is one letter.
    expect(tidyIndic("বো")).toBe("বো");
    expect(indicScriptFixer(["त्यो"], "ne")("त्ो")).toBe("तो");
  });

  it("drops unknown-sound markers and vowel signs that would start a word", () => {
    const words = tokensToWords(["प", "र", "<unk>", "य", "ो", " ", "ो", "ग", "ो"], [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], 0, 1);
    expect(texts(words)).toEqual(["परयो", "गो"]);
  });

  it("sends a video to one model from the language heard at several points", () => {
    const w = (lang: string, weight = 29) => ({ lang, weight });
    expect(engineForWindows([])).toEqual({ engine: "english", language: "en" });
    // One stray guess doesn't make an English video multilingual.
    expect(engineForWindows([w("en"), w("en"), w("en"), w("en"), w("cy")])).toEqual({ engine: "english", language: "en" });
    // English with Nepali, heard as several Indian languages: the multilingual model, named by the most heard.
    expect(engineForWindows([w("en"), w("en"), w("ne"), w("hi"), w("ne", 10)])).toEqual({ engine: "omni", language: "ne" });
    // Portuguese with a Galician guess stays on the European model, which also knows English.
    expect(engineForWindows([w("pt"), w("pt"), w("gl"), w("en"), w("pt")])).toEqual({ engine: "european", language: "pt" });
    expect(engineForWindows([w("ml"), w("ml"), w("hi")])).toEqual({ engine: "omni", language: "ml" });
    expect(engineForWindows([w("el"), w("el"), w("el"), w("en")])).toEqual({ engine: "omni", language: "el" });
  });

  it("finds the script of a transcript and of a language", () => {
    expect(scriptOf("क")).toBe("Devanagari");
    expect(scriptOf("ि")).toBe("Devanagari");
    expect(scriptOf("か")).toBe("Han");
    expect(scriptOf("7")).toBeNull();
    expect(scriptShare("hello नमस्ते", "Devanagari")).toBeCloseTo(6 / 11);
    expect(scriptShare("123", "Latin")).toBe(1);
    // A podcast mostly in English with Nepali parts is still Devanagari.
    expect(mainScript(["so we sat down and talked about it for a long time", "धेरै भिडियो"])).toBe("Devanagari");
    expect(mainScript(["hello there my friend how are you doing today", "न"])).toBe("Latin");
    expect(mainScript(["", " "])).toBeNull();
    expect([scriptOfLanguage("ne"), scriptOfLanguage("ur"), scriptOfLanguage("ja"), scriptOfLanguage("sw")]).toEqual(["Devanagari", "Arabic", "Han", null]);
    expect([scriptOfLanguage("el"), scriptOfLanguage("ru"), scriptOfLanguage("sr")]).toEqual(["Greek", "Cyrillic", "Cyrillic"]);
    // Serbian and Uzbek are written in Latin letters too: a transcript in them is in its own script.
    expect([scriptOfLanguage("sr", "Latin"), scriptOfLanguage("uz", "Latin"), scriptOfLanguage("ru", "Latin")]).toEqual(["Latin", "Latin", "Cyrillic"]);
  });

  it("names the language from the transcript's common words when detection disagrees", () => {
    const nepali = ["मलाई धेरै भिडियो हेर्न गाहरो पर्छ", "त्यो भिडियोमा पनि छ", "हामी पनि गयौं अनि त्यो हो"];
    const hindi = ["यह वीडियो बहुत अच्छा है", "और हम भी वहाँ थे", "क्या आप भी हैं"];
    expect(languageForScript("ml", "Devanagari", nepali)).toBe("ne");
    expect(languageForScript("hi", "Devanagari", nepali)).toBe("ne");
    expect(languageForScript("hi", "Devanagari", hindi)).toBe("hi");
    expect(languageForScript("ne", "Devanagari", hindi)).toBe("hi");
    // Another script with no common words known: its main language.
    expect(languageForScript("ta", "Devanagari", ["क ख"])).toBe("hi");
    expect(languageForScript("sw", "Latin", ["habari yako"])).toBe("sw");
    // Serbian in Cyrillic is Serbian (it was once named Belarusian, the first Cyrillic language in the list), in Latin letters too.
    expect(languageForScript("sr", "Cyrillic", ["а у ком моменту се ту нашла"])).toBe("sr");
    expect(languageForScript("sr", "Latin", ["a u kom momentu se tu našla"])).toBe("sr");
    expect(languageForScript("mn", "Cyrillic", ["сайн байна уу"])).toBe("mn");
    // A Cyrillic transcript of a language that isn't written in Cyrillic: most likely Russian.
    expect(languageForScript("cy", "Cyrillic", ["привет как дела"])).toBe("ru");
  });

  it("cuts a stretch of speech with no pause at its quietest moments", () => {
    const rate = 1000;
    // 53 s of sound with a quiet fifth of a second at 16.4 s and at 36.1 s.
    const sound = Float32Array.from({ length: 53 * rate }, (_, i) => (i % 2 ? 0.5 : -0.5));
    for (const at of [16.4, 36.1]) sound.fill(0.001, at * rate, (at + 0.2) * rate);
    const pieces = splitLongSpeech(sound, 20 * rate, rate);
    expect(pieces.map((p) => Math.round((p.start / rate) * 10) / 10)).toEqual([0, 16.5, 36.2]);
    expect(pieces.reduce((n, p) => n + p.length, 0)).toBe(sound.length);
    expect(Math.max(...pieces.map((p) => p.length))).toBeLessThanOrEqual(20 * rate);
    // Even sound has no better place than another: about equal pieces, none tiny.
    const even = splitLongSpeech(new Float32Array(41 * rate).fill(0.3), 20 * rate, rate);
    expect(even.map((p) => Math.round(p.length / rate))).toEqual([14, 14, 14]);
    expect(splitLongSpeech(new Float32Array(20 * rate), 20 * rate, rate)).toEqual([{ start: 0, length: 20 * rate }]);
    expect(splitLongSpeech(new Float32Array(0), 20 * rate, rate)).toEqual([{ start: 0, length: 0 }]);
  });

  it("finds where the European model wrote another language as English, sentence by sentence", () => {
    expect(englishLook("What is your city favorite in Madrid?")).toMatchObject({ words: 7, hits: 2 });
    expect(looksEnglish("What is your city favorite in Madrid?")).toBe(true);
    expect(looksEnglish("¿Cuál es tu sitio favorito en Madrid?")).toBe(false);
    // Words Dutch, German and Danish share with English don't count.
    expect(looksEnglish("Dat is in het water, want we hebben was")).toBe(false);
    expect(looksEnglish("Le but de la soirée")).toBe(false);

    const words = (text: string) => text.split(" ").map((t) => ({ text: t }));
    const stretch = (text: string) => englishStretches(words(text)).map((r) => words(text).slice(r.from, r.to).map((w) => w.text).join(" "));
    expect(stretch("Y'a trois ans. And it's been? It's super cool. And it's comment? Voilà. Ouais.")).toEqual(["And it's been? It's super cool. And it's comment?"]);
    expect(stretch("Pareil, c'est l'Italie. And we're for des vacances or autre chose?")).toEqual(["And we're for des vacances or autre chose?"]);
    expect(stretch("Venimos por eso. La gente de Madrid.")).toEqual([]);
    expect(englishStretches([])).toEqual([]);
  });

  it("takes the second reading only where the first was broken English and the second isn't English", () => {
    expect(preferOtherReading("What is your city favorite in Madrid?", "cuál es tu sitio favorito en madrid")).toBe(true);
    expect(preferOtherReading("And we're for des vacances or autre chose?", "et vous y êtes allé pour des vacances ou autre chose")).toBe(true);
    // English there too: the speech is English.
    expect(preferOtherReading("So what do you think about this one?", "so what do you think about this one")).toBe(false);
    // The same words but for an English phrase the speaker used: the first reading stays.
    expect(preferOtherReading("Dat was echt zo'n what the hell moment.", "dat was echt zo'n wat de hel moment")).toBe(false);
    // Hardly anything heard: not a reading to trust.
    expect(preferOtherReading("What is your city favorite in Madrid?", "uiáiciam")).toBe(false);

    const said = asSentence([{ text: "cuál" }, { text: "es" }, { text: "tu" }, { text: "sitio" }], "es");
    expect(said.map((w) => w.text).join(" ")).toBe("Cuál es tu sitio.");
    expect(asSentence([{ text: "istanbul'da" }], "tr")[0]!.text).toBe("İstanbul'da.");
    expect(asSentence([{ text: "¿qué?" }], "es")[0]!.text).toBe("¿qué?");
    expect(asSentence([], "es")).toEqual([]);
  });

  it("finds where the English model agrees, English runs among other words, and mixed-script spellings", () => {
    const english = wordAgreement(["when", "we", "have", "hope", "you", "know"], ["When", "we", "have", "hope,", "you", "know."]);
    expect(english.ratio).toBe(1);
    expect(wordAgreement(["lakiate", "kantiwa"], ["Laguerte", "Catio."]).ratio).toBe(0);
    // Written half in Devanagari, the model unsure of the language: close spellings count.
    const mixed = wordAgreement(["gिve", "मे", "the", "गreen", "light", "पन", "तो"], ["give", "me", "the", "green", "light", "bunny"]);
    expect(mixed.matched).toEqual([true, false, true, true, true, false, false]);
    // A word wholly in Devanagari has to match exactly: the English model spells Nepali as English-like words.
    expect(wordAgreement(["मिलार", "हुन्छ"], ["Milara", "hunch"]).ratio).toBe(0);
    expect(romanize("प्रब्लेम")).toBe("prblem");
    expect(romanize("mीtिnग")).toBe("miting");

    const words = ["तब", "असम्भव", "when", "we", "x", "have", "hope", "पनि"].map((text, i) => ({ text, start: i, end: i + 0.9 }));
    const matched = [false, false, true, true, false, true, true, false];
    expect(englishSpans(words, matched)).toEqual([{ start: 2, end: 6.9 }]);
    expect(englishSpans(words, [false, false, true, true, false, false, false, false])).toEqual([]);
  });

  it("offers to transcribe again where the transcriber has improved", () => {
    const project = (over: object) =>
      ({ hasTranscript: true, transcriptEngine: "device", spokenLanguage: "ne", source: { hasAudio: true }, ...over }) as Parameters<typeof retranscribeReason>[0];
    expect(retranscribeReason(project({}))).toBe("languages");
    expect(retranscribeReason(project({ transcriber: TRANSCRIBER_VERSION }))).toBeNull();
    expect(retranscribeReason(project({ spokenLanguage: "en" }))).toBeNull();
    expect(retranscribeReason(project({ spokenLanguage: "de" }))).toBeNull();
    expect(retranscribeReason(project({ transcriptEngine: "gemini", transcriber: TRANSCRIBER_VERSION }))).toBe("timing");
    expect(retranscribeReason(project({ hasTranscript: false }))).toBeNull();
    // Greek made by the European model lost every final sigma.
    expect(retranscribeReason(project({ spokenLanguage: "el", transcriber: 2 }))).toBe("spelling");
    expect(retranscribeReason(project({ spokenLanguage: "el", transcriber: TRANSCRIBER_VERSION }))).toBeNull();
    expect(retranscribeReason(project({ spokenLanguage: "ne", transcriber: 2 }))).toBeNull();
    // The app and the worker agree on what Parakeet transcribes.
    expect([...PARAKEET_LANGUAGES].sort()).toEqual(["en", ...EUROPEAN].sort());
    expect([usesMultilingualModel("ne"), usesMultilingualModel("en-GB"), usesMultilingualModel("auto")]).toEqual([true, false, false]);
  });

  it("names languages", () => {
    expect([languageName("hi"), languageName("auto"), languageName("other"), languageName("yue")]).toEqual(["Hindi", "Detect automatically", "Detect automatically", "Cantonese"]);
  });
});

describe("captions in scripts without spaces", () => {
  it("joins their words without spaces, and others with", () => {
    expect(wordGap("今日は", "天気")).toBe("");
    expect(wordGap("iPhone", "を")).toBe(" ");
    expect(joinWords(["今日は", "天気", "iPhone", "15を"])).toBe("今日は天気 iPhone 15を");
    expect(displayText("สวัสดี ครับ")).toBe("สวัสดีครับ");
    expect(displayText("hello there")).toBe("hello there");
  });

  it("keeps lines narrow enough to fit, since the export can't wrap them", () => {
    const words = ["今日は", "とても", "良い", "天気ですね", "みんなで", "公園に", "行きましょう"];
    const seg = { start: 0, end: 7, text: words.join(" "), words: words.map((_, i) => ({ start: i, end: i + 0.9 })) };
    const lines = captionLines([seg], 0, 7, "clean");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textEm(joinWords(l.words.map((w) => w.text)))).toBeLessThanOrEqual(16);
    // Latin keeps the usual words per line (and wraps at spaces).
    const en = { start: 0, end: 7, text: "one two three four five six seven", words: words.map((_, i) => ({ start: i, end: i + 0.9 })) };
    expect(captionLines([en], 0, 7, "clean")).toHaveLength(1);
  });

  it("breaks long titles into lines", () => {
    const lines = titleLines("日本語が上手ってなんだろう？外国人が本当に知りたいこと");
    expect(lines.length).toBeGreaterThan(1);
    for (const l of lines) expect(textEm(l)).toBeLessThanOrEqual(17);
    expect(lines.join("")).toBe("日本語が上手ってなんだろう？外国人が本当に知りたいこと");
    expect(titleLines("A title in English")).toEqual(["A title in English"]);
  });

  it("exports them without spaces, with title lines", () => {
    const ass = buildAss({
      lines: [{ start: 0, end: 2, words: [{ text: "今日は", start: 0, end: 1 }, { text: "天気", start: 1, end: 2 }] }],
      aspect: "9:16",
      style: "clean",
      position: "bottom",
      durationSec: 2,
      title: "日本語が上手ってなんだろう？外国人が本当に知りたいこと",
    });
    expect(ass).toContain(",今日は天気\n");
    expect(ass).toMatch(/Title,,0,0,0,,[^\n]+\\N/);
  });
});

describe("caption fonts", () => {
  it("draws Latin with Bricolage and other scripts with their Noto font", () => {
    expect(fontRuns("Hi नमस्ते!", "hi").map((r) => [r.font?.id, r.text])).toEqual([
      ["Bricolage", "Hi "],
      ["NotoSansDevanagari", "नमस्ते"],
      ["Bricolage", "!"],
    ]);
    expect(fontRuns("Привет").map((r) => r.font?.id)).toEqual(["NotoSans"]);
    expect(fontRuns("مرحبا").map((r) => r.font?.id)).toEqual(["NotoSansArabic"]);
  });

  it("picks the Chinese-character font that suits the language", () => {
    expect(fontRuns("天気", "ja")[0]!.font?.id).toBe("NotoSansJP");
    expect(fontRuns("天气", "zh")[0]!.font?.id).toBe("NotoSansSC");
    expect(fontRuns("한국어", "ko")[0]!.font?.id).toBe("NotoSansKR");
    expect(captionFontOrder("zh-TW").at(-4)!.id).toBe("NotoSansTC");
  });

  it("switches font in the export, sized so an em matches Bricolage's", () => {
    const out = assMarkup("Hi मित्र", 80, "hi");
    expect(out).toMatch(/^Hi \{\\fnNoto Sans Devanagari ExtraBold\\fs(\d+(\.\d)?)\}मित्र\{\\fnBricolage Grotesque 36pt ExtraBold\\fs80\}$/);
    const fs = Number(/\\fs(\d+(?:\.\d)?)\}मित्र/.exec(out)![1]);
    expect(fs).toBeGreaterThan(80); // Noto Devanagari is taller than Bricolage (1.906 em against 1.56)
    expect(assMarkup("plain {text}", 80)).toBe("plain (text)");
    expect(fontsNeeded(["Hi", "नमस्ते", "天気"], "ja").map((f) => f.id).sort()).toEqual(["NotoSansDevanagari", "NotoSansJP"]);
  });

  it("declares every font for the preview, highest priority last", () => {
    const css = captionFontCss("ja");
    const order = [...css.matchAll(/url\("\/api\/fonts\/([^"]+)"\)/g)].map((m) => m[1]);
    expect(order.at(-1)).toBe("BricolageGrotesque-ExtraBold.ttf");
    expect(order[0]).not.toBe("NotoSansJP-Bold.otf");
    expect(order.indexOf("NotoSansJP-Bold.otf")).toBeGreaterThan(order.indexOf("NotoSansSC-Bold.otf"));
    expect(css).toContain('font-family:"Bamio Caption"');
  });
});
