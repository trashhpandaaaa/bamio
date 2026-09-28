import { describe, expect, it } from "vitest";
import { maxWordSec, tokensToWords, wordsToPhrases } from "../../workers/transcribe-core.mjs";
import { captionLines, segmentWordTimes } from "@/lib/clips/logic";

describe("tokensToWords", () => {
  it("joins word pieces and punctuation, and places words in the video", () => {
    const words = tokensToWords([" for", " this", ",", " I", " sur", "v", "ive", "."], [0.4, 0.56, 0.7, 0.8, 1.0, 1.1, 1.2, 1.4], 100, 102);
    expect(words.map((w) => w.text)).toEqual(["for", "this,", "I", "survive."]);
    expect(words.map((w) => w.start)).toEqual([100.4, 100.56, 100.8, 101]);
  });

  it("ends a word at the next word, the end of its speech, or a sensible length", () => {
    const words = tokensToWords([" a", " b", " extraordinary"], [0, 0.3, 0.5], 10, 20);
    expect(words[0]!.end).toBe(10.3); // the next word
    expect(words[2]!.end).toBeCloseTo(10.5 + maxWordSec("extraordinary"), 3); // capped, not until 20 s
    const last = tokensToWords([" hi"], [0.1], 5, 5.3);
    expect(last[0]).toMatchObject({ start: 5.1, end: 5.3 }); // the end of its speech part
  });

  it("copes with a first token without a leading space and with empty tokens", () => {
    expect(tokensToWords(["hello", " ", " world"], [0, 0.2, 0.4], 0, 1).map((w) => w.text)).toEqual(["hello", "world"]);
    expect(tokensToWords([], [], 0, 1)).toEqual([]);
  });
});

describe("wordsToPhrases", () => {
  const w = (text: string, start: number) => ({ text, start, end: start + 0.25 });

  it("breaks after sentences and at pauses, and keeps every word's time", () => {
    const phrases = wordsToPhrases([w("Here", 0), w("it", 0.3), w("is.", 0.6), w("Then", 1.0), w("we", 1.3), w("wait", 2.5)]);
    expect(phrases.map((p) => p.text)).toEqual(["Here it is.", "Then we", "wait"]);
    expect(phrases[0]).toMatchObject({ start: 0, end: 0.85, words: [{ start: 0 }, { start: 0.3 }, { start: 0.6 }] });
  });

  it("breaks at a comma only once the phrase has some length, and never passes 14 words", () => {
    const short = wordsToPhrases([w("Yes,", 0), w("right", 0.3)]);
    expect(short).toHaveLength(1);
    const long = wordsToPhrases(Array.from({ length: 30 }, (_, i) => w(`w${i}`, i * 0.3)));
    expect(long.map((p) => p.words.length)).toEqual([14, 14, 2]);
    const comma = wordsToPhrases(["a", "b", "c", "d", "e", "f,", "g", "h"].map((t, i) => w(t, i * 0.3)));
    expect(comma.map((p) => p.text)).toEqual(["a b c d e f,", "g h"]);
  });
});

describe("captions from timed words", () => {
  const seg = { start: 0, end: 4, text: "one two three", words: [{ start: 0.5, end: 0.8 }, { start: 1.9, end: 2.2 }, { start: 3, end: 3.4 }] };

  it("use the measured word times", () => {
    expect(segmentWordTimes(seg).map((x) => x.start)).toEqual([0.5, 1.9, 3]);
    expect(captionLines([seg], 0, 4, "clean")[0]).toMatchObject({ start: 0.5, end: 3.4 });
  });

  it("fall back to estimates when the words were edited", () => {
    expect(segmentWordTimes({ ...seg, text: "one two three four" })[0]!.start).toBe(0);
  });
});
