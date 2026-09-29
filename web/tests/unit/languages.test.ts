import { describe, expect, it } from "vitest";
import { engineFor, indicScriptFixer, splitIntoWords, tokensToWords, wordsToPhrases } from "../../workers/transcribe-core.mjs";
import { buildAss } from "@/lib/clips/ass";
import { languageName } from "@/lib/clips/languages";
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
