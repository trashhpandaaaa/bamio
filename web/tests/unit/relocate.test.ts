import { describe, expect, it } from "vitest";
import { relocateAiClips, relocateRange } from "@/lib/clips/relocate";
import type { Segment } from "@/lib/clips/schema";

const SENTENCES = [
  "the bank robber walked in and asked the teller for the money",
  "nobody in the room expected what the old cop did next",
  "he just smiled and offered the guy a cup of coffee",
  "then we started talking about why real tough guys are quiet",
  "movies never show that part because it is not dramatic enough",
  "anyway that is how the whole story ended up in the script",
  "later we talked about psychedelics and how they help veterans heal",
  "the research is still early but the results look really promising",
];

/** A transcript with measured word times: each sentence 4 s long, a gap of 1 s between. */
function spoken(offset = 0): Segment[] {
  return SENTENCES.map((text, i) => {
    const start = offset + i * 5;
    const words = text.split(" ").map((_, k, all) => ({ start: start + (4 * k) / all.length, end: start + (4 * (k + 1)) / all.length }));
    return { start, end: start + 4, text, words };
  });
}

describe("relocateRange", () => {
  it("finds a clip's words when the old transcript placed them minutes off", () => {
    const truth = spoken(0);
    const old = spoken(180).map((s) => ({ ...s, words: undefined })); // Gemini-style: 3 minutes late, no word times
    // The old clip covered sentences 3 and 4 (180 + 15 .. 180 + 24).
    const found = relocateRange(old, truth, 195, 204);
    expect(found).not.toBeNull();
    expect(found!.start).toBeCloseTo(15 - 0.1, 1);
    expect(found!.end).toBeCloseTo(24 + 0.25, 1);
    expect(found!.matched).toBeGreaterThan(0.9);
  });

  it("copes with extra filler words in the new transcript", () => {
    const truth = spoken(0).map((s) => ({ ...s, text: s.text.replace("just smiled", "just you know smiled"), words: undefined }));
    const old = spoken(60);
    const found = relocateRange(old, truth, 70, 74);
    expect(found).not.toBeNull();
    expect(found!.start).toBeCloseTo(10 - 0.1, 0);
  });

  it("gives up when the words aren't there", () => {
    const other = [{ start: 0, end: 4, text: "completely different words about cooking pasta at home tonight" }];
    expect(relocateRange(spoken(0), other, 0, 9)).toBeNull();
    expect(relocateRange(spoken(0), spoken(0), 0, 1)).toBeNull(); // too few words to be sure
  });
});

describe("relocateAiClips", () => {
  it("moves AI clips, leaves hand-marked clips alone, and counts real moves", () => {
    const truth = spoken(0);
    const old = spoken(120);
    const clips = [
      { id: "a", origin: "ai" as const, start: 135, end: 144 },
      { id: "m", origin: "manual" as const, start: 135, end: 144 },
      { id: "x", origin: "ai" as const, start: 500, end: 520 }, // nothing there
    ];
    const { clips: out, moved } = relocateAiClips(clips, old, truth, 60);
    expect(moved).toBe(1);
    expect(out[0]!.start).toBeCloseTo(14.9, 1);
    expect(out[1]).toEqual(clips[1]);
    expect(out[2]).toEqual(clips[2]);
  });
});
