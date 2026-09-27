import { describe, expect, it } from "vitest";
import { createProject, DEFAULT_STYLE } from "@/lib/project/ops";
import type { Brief, Project, Scene } from "@/lib/project/schema";
import {
  audioKeyFor,
  buildTimeline,
  effectiveDuration,
  fitDurations,
  formatDuration,
  formatTimecode,
  itemAt,
  VOICE_TAIL_SEC,
  wordTimings,
} from "@/lib/project/timeline";

const brief: Brief = { idea: "Cold brew for people who hate mornings", durationSec: 15, tone: "bold", voiceover: true };

function project(scenes: Partial<Scene>[]): Project {
  const p = createProject({ brief });
  return { ...p, style: { ...DEFAULT_STYLE }, scenes: scenes.map((s, i) => ({ ...p.scenes[0]!, id: `s${i}`, ...s })) };
}

describe("buildTimeline / itemAt", () => {
  it("lays scenes end to end", () => {
    const tl = buildTimeline(project([{ durationSec: 2 }, { durationSec: 3 }, { durationSec: 1.5 }]));
    expect(tl.total).toBeCloseTo(6.5);
    expect(tl.items.map((i) => [i.start, i.end])).toEqual([
      [0, 2],
      [2, 5],
      [5, 6.5],
    ]);
  });

  it("finds the scene at a time, clamping both ends", () => {
    const tl = buildTimeline(project([{ durationSec: 2 }, { durationSec: 3 }]));
    expect(itemAt(tl, -1)?.index).toBe(0);
    expect(itemAt(tl, 0)?.index).toBe(0);
    expect(itemAt(tl, 1.999)?.index).toBe(0);
    expect(itemAt(tl, 2)?.index).toBe(1);
    expect(itemAt(tl, 99)?.index).toBe(1);
    expect(itemAt({ items: [], total: 0 }, 1)).toBeUndefined();
  });
});

describe("effectiveDuration", () => {
  it("stretches a scene to fit current voice-over audio", () => {
    const p = project([{ durationSec: 2, voiceover: "hello there", audioId: "a", audioDurationSec: 3, audioKey: audioKeyFor("hello there", "Puck") }]);
    expect(effectiveDuration(p.scenes[0]!, p)).toBeCloseTo(3 + VOICE_TAIL_SEC);
  });

  it("ignores stale audio (text changed) and audio when voice-over is off", () => {
    const stale = project([{ durationSec: 2, voiceover: "new text", audioId: "a", audioDurationSec: 3, audioKey: audioKeyFor("old text", "Puck") }]);
    expect(effectiveDuration(stale.scenes[0]!, stale)).toBe(2);
    const off = { ...stale, brief: { ...brief, voiceover: false } };
    expect(effectiveDuration(off.scenes[0]!, off)).toBe(2);
  });

  it("treats audio as stale when the voice changes", () => {
    const p = project([{ durationSec: 2, voiceover: "hi", audioId: "a", audioDurationSec: 4, audioKey: audioKeyFor("hi", "Kore") }]);
    expect(effectiveDuration(p.scenes[0]!, p)).toBe(2);
  });
});

describe("wordTimings", () => {
  it("covers the whole span in order, weighted by length", () => {
    const t = wordTimings(["a", "banana", "is", "yellow"], 4);
    expect(t[0]!.start).toBe(0);
    expect(t.at(-1)!.end).toBeCloseTo(4);
    for (let i = 1; i < t.length; i++) expect(t[i]!.start).toBeCloseTo(t[i - 1]!.end);
    expect(t[1]!.end - t[1]!.start).toBeGreaterThan(t[0]!.end - t[0]!.start);
  });

  it("returns nothing for no words or no time", () => {
    expect(wordTimings([], 3)).toEqual([]);
    expect(wordTimings(["x"], 0)).toEqual([]);
  });
});

describe("fitDurations", () => {
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  it("leaves durations alone when already within 10% of the target", () => {
    expect(fitDurations([3, 4, 4, 4], 15)).toEqual([3, 4, 4, 4]);
  });

  it("scales durations to the target", () => {
    const out = fitDurations([10, 10, 10, 10], 20);
    expect(sum(out)).toBeCloseTo(20, 0);
    expect(out.every((d) => d === 5)).toBe(true);
  });

  it("keeps every scene within the allowed range", () => {
    const out = fitDurations([0.1, 100, 5], 30);
    expect(out.every((d) => d >= 1 && d <= 20)).toBe(true);
  });

  it("replaces invalid numbers", () => {
    const out = fitDurations([Number.NaN, -3, 4], 12);
    expect(out.every((d) => Number.isFinite(d) && d >= 1)).toBe(true);
  });
});

describe("formatting", () => {
  it("formats timecodes and durations", () => {
    expect(formatTimecode(0)).toBe("00:00.00");
    expect(formatTimecode(9.12)).toBe("00:09.12");
    expect(formatTimecode(75.5)).toBe("01:15.50");
    expect(formatTimecode(-2)).toBe("00:00.00");
    expect(formatDuration(28.4)).toBe("0:28");
    expect(formatDuration(61)).toBe("1:01");
  });
});
