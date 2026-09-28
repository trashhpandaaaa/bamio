import { describe, expect, it } from "vitest";
import {
  captionLines,
  clipRangeError,
  cropRect,
  exportSignature,
  formatTimecode,
  lineAt,
  normalizeClips,
  overlayTitle,
  parseTimecode,
  sortClips,
} from "@/lib/clips/logic";
import { DEFAULT_EDIT, type Segment } from "@/lib/clips/schema";

describe("timecodes", () => {
  it("formats minutes, hours and hundredths", () => {
    expect(formatTimecode(0)).toBe("0:00");
    expect(formatTimecode(75.4)).toBe("1:15");
    expect(formatTimecode(3723)).toBe("1:02:03");
    expect(formatTimecode(12.345, { hundredths: true })).toBe("0:12.34");
    expect(formatTimecode(-5)).toBe("0:00");
  });

  it("parses what it formats, and plain seconds", () => {
    expect(parseTimecode("1:15")).toBe(75);
    expect(parseTimecode("1:02:03")).toBe(3723);
    expect(parseTimecode("0:12.34")).toBeCloseTo(12.34);
    expect(parseTimecode("75.5")).toBe(75.5);
    expect(parseTimecode(formatTimecode(4000.25, { hundredths: true }))).toBeCloseTo(4000.25);
  });

  it("rejects invalid times", () => {
    for (const bad of ["", "abc", "1:75", "1:60:00", "-3", "1::2", "1:2:3:4"]) expect(parseTimecode(bad)).toBeNull();
  });
});

describe("clip ranges", () => {
  it("accepts a valid range and explains invalid ones", () => {
    expect(clipRangeError(10, 40, 100)).toBeNull();
    expect(clipRangeError(-1, 10, 100)).toMatch(/before the video/);
    expect(clipRangeError(90, 101, 100)).toMatch(/after the video ends/);
    expect(clipRangeError(10, 11, 100)).toMatch(/at least 3 seconds/);
    expect(clipRangeError(0, 200, 1000)).toMatch(/up to 3 minutes/);
    expect(clipRangeError(Number.NaN, 5, 100)).toMatch(/start and an end/);
  });
});

const segs: Segment[] = [
  { start: 0, end: 2, text: "one two three four" },
  { start: 2, end: 4, text: "five six" },
  { start: 10, end: 12, text: "far away words" },
];

describe("captionLines", () => {
  it("splits phrases into lines, relative to the clip", () => {
    const lines = captionLines(segs, 1, 5, "pop");
    const words = lines.flatMap((l) => l.words.map((w) => w.text));
    // Words are timed by length: "one" and "two" sit mostly before 1 s, so they're left out.
    expect(words).toEqual(["three", "four", "five", "six"]);
    expect(lines.every((l) => l.words.length <= 3)).toBe(true);
    expect(lines[0]!.start).toBeGreaterThanOrEqual(0);
    expect(lines.at(-1)!.end).toBeLessThanOrEqual(4);
  });

  it("uses longer lines for clean and boxed", () => {
    expect(captionLines(segs, 0, 5, "clean")[0]!.words).toHaveLength(4);
  });

  it("finds the line at a time", () => {
    const lines = captionLines(segs, 0, 5, "pop");
    expect(lineAt(lines, 0.1)?.words[0]?.text).toBe("one");
    expect(lineAt(lines, 4.5)).toBeUndefined();
  });

  it("skips empty and zero-length phrases", () => {
    expect(captionLines([{ start: 1, end: 1, text: "x" }, { start: 2, end: 3, text: "  " }], 0, 10, "pop")).toEqual([]);
  });
});

describe("cropRect", () => {
  it("crops a landscape source to vertical around the focus", () => {
    expect(cropRect(1920, 1080, "9:16", 0.5)).toEqual({ w: 606, h: 1080, x: 656, y: 0 });
    expect(cropRect(1920, 1080, "9:16", 0).x).toBe(0);
    expect(cropRect(1920, 1080, "9:16", 1)).toMatchObject({ x: 1314 });
  });

  it("crops a vertical source to wide, centred", () => {
    expect(cropRect(1080, 1920, "16:9", 0.5)).toEqual({ w: 1080, h: 606, x: 0, y: 656 });
  });

  it("keeps a matching source whole", () => {
    expect(cropRect(1920, 1080, "16:9", 0.3)).toEqual({ w: 1920, h: 1080, x: 0, y: 0 });
  });

  it("returns even sizes inside the source", () => {
    const r = cropRect(1279, 719, "1:1", 0.77);
    expect(r.w % 2).toBe(0);
    expect(r.x % 2).toBe(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1279);
  });
});

describe("normalizeClips", () => {
  const opts = { durationSec: 100, segments: [{ start: 9.5, end: 20, text: "a" }, { start: 20, end: 41.2, text: "b" }] };

  it("snaps to phrase edges, rounds and keeps the best of overlapping clips", () => {
    const out = normalizeClips(
      [
        { start: 10, end: 41, title: "  Good  ", score: 70 },
        { start: 12, end: 40, title: "Better", score: 90.4 },
        { start: 60, end: 80, title: "", score: 50 },
      ],
      opts,
    );
    expect(out.map((c) => c.title)).toEqual(["Better", "Untitled clip"]);
    expect(out[0]).toMatchObject({ start: 12, end: 41.2, score: 90 });
  });

  it("clamps into the media and enforces length limits", () => {
    const [clip] = normalizeClips([{ start: 98, end: 120, title: "End" }], { ...opts, minSec: 5 });
    expect(clip).toMatchObject({ start: 95, end: 100 });
    const [long] = normalizeClips([{ start: 0, end: 90, title: "Long" }], { ...opts, maxSec: 30 });
    expect(long!.end - long!.start).toBeCloseTo(30);
  });

  it("drops bad numbers and respects the maximum count", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ start: i * 10, end: i * 10 + 5, title: `c${i}`, score: i }));
    expect(normalizeClips([{ start: Number.NaN, end: 5, title: "x" }, ...many], { ...opts, max: 3 })).toHaveLength(3);
  });
});

describe("exports and titles", () => {
  const clip = { title: "My clip", start: 1, end: 9, edit: DEFAULT_EDIT };

  it("changes the signature when the edit changes, not when keys reorder", () => {
    const base = exportSignature(clip, 1);
    const reordered = { ...clip, edit: Object.fromEntries(Object.entries(DEFAULT_EDIT).reverse()) as typeof DEFAULT_EDIT };
    expect(exportSignature(reordered, 1)).toBe(base);
    expect(exportSignature({ ...clip, end: 10 }, 1)).not.toBe(base);
    expect(exportSignature({ ...clip, edit: { ...DEFAULT_EDIT, aspect: "1:1" } }, 1)).not.toBe(base);
    expect(exportSignature(clip, 2)).not.toBe(base);
    // Transcript edits don't matter when captions are off.
    const noCaps = { ...clip, edit: { ...DEFAULT_EDIT, captions: false } };
    expect(exportSignature(noCaps, 1)).toBe(exportSignature(noCaps, 5));
  });

  it("falls back to the clip name for the title overlay", () => {
    expect(overlayTitle(clip)).toBe("");
    expect(overlayTitle({ ...clip, edit: { ...DEFAULT_EDIT, showTitle: true } })).toBe("My clip");
    expect(overlayTitle({ ...clip, edit: { ...DEFAULT_EDIT, showTitle: true, titleText: " Hi " } })).toBe("Hi");
  });

  it("sorts by score or by time", () => {
    const list = [
      { id: "a", start: 30, score: 50, createdAt: 1 },
      { id: "b", start: 10, createdAt: 3 },
      { id: "c", start: 20, score: 90, createdAt: 2 },
    ];
    expect(sortClips(list, "best").map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(sortClips(list, "time").map((c) => c.id)).toEqual(["b", "c", "a"]);
  });
});
