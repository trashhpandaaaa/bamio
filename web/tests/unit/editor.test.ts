import { describe, expect, it } from "vitest";
import { clipOf, clock, editSchema, lookFilter, newEdit, TEXT_SIZE, type Edit, type Media } from "@/lib/editor/model";
import { envelopeOf, loudLevel, SILENCE_PRESETS, silenceCuts, silences } from "@/lib/editor/silence";
import {
  addMedia,
  addText,
  audioLength,
  clipLength,
  duplicateItem,
  exportProblem,
  fade,
  layout,
  mergeRanges,
  momentAt,
  motionScale,
  moveClip,
  moveOverlay,
  patchClip,
  patchText,
  removeItem,
  rippleDelete,
  rowsOf,
  setSpeed,
  snap,
  snapPoints,
  splitAt,
  textPose,
  totalDuration,
  trimClip,
  trimOverlay,
} from "@/lib/editor/timeline";

const video = (id: string, duration: number): Media => ({ id, kind: "video", name: `${id}.mp4`, size: 1000, duration, width: 1920, height: 1080, hasAudio: true });
const photo: Media = { id: "p", kind: "image", name: "p.jpg", size: 10, duration: 0, width: 800, height: 600, hasAudio: false };
const song: Media = { id: "s", kind: "audio", name: "s.mp3", size: 10, duration: 30, width: 0, height: 0, hasAudio: true };

/** Two videos (10 s and 6 s), a photo (4 s) and a song from 2 s. */
function sample(): Edit {
  return addMedia(addMedia(newEdit("Test", 1), [video("a", 10), video("b", 6), photo]), [song], 2);
}
const lengths = (edit: Edit) => edit.clips.map((c) => Number(clipLength(c).toFixed(3)));

describe("the editor's timeline", () => {
  it("lays clips one after another, photos for four seconds, sounds where they're dropped", () => {
    const edit = sample();
    expect(layout(edit).map((p) => [p.from, p.to])).toEqual([[0, 10], [10, 16], [16, 20]]);
    expect(totalDuration(edit)).toBe(20);
    expect(edit.clips[2]).toMatchObject({ mediaId: "p", start: 0, end: 4, motion: "in" });
    expect(edit.audio[0]).toMatchObject({ mediaId: "s", at: 2, start: 0, end: 30 });
    expect(edit.media.map((m) => m.id)).toEqual(["a", "b", "p", "s"]);
    // The same file added again is one file, two clips.
    expect(addMedia(edit, [video("a", 10)]).media).toHaveLength(4);
    expect(editSchema.safeParse(edit).success).toBe(true);
  });

  it("knows what plays at a moment, in the clip's own file", () => {
    const base = sample();
    const edit = setSpeed(base, base.clips[0]!.id, 2);
    // The first clip at double speed lasts 5 s.
    expect(totalDuration(edit)).toBe(15);
    expect(momentAt(edit, 2)).toMatchObject({ index: 0, local: 2, source: 4 });
    expect(momentAt(edit, 5)).toMatchObject({ index: 1, local: 0, source: 0 });
    // Past the end: the last frame of the last clip.
    expect(momentAt(edit, 99)?.index).toBe(2);
    expect(momentAt(edit, 99)!.local).toBeCloseTo(3.96, 2);
    expect(momentAt(newEdit(), 0)).toBeNull();
  });

  it("splits a clip at the playhead, and refuses slivers", () => {
    const edit = sample();
    const { edit: cut, selection } = splitAt(edit, 4, null);
    expect(lengths(cut)).toEqual([4, 6, 6, 4]);
    expect(cut.clips[0]).toMatchObject({ start: 0, end: 4 });
    expect(cut.clips[1]).toMatchObject({ start: 4, end: 10, mediaId: "a" });
    expect(selection).toEqual({ kind: "clip", id: cut.clips[1]!.id });
    expect(totalDuration(cut)).toBe(20);
    // 0.05 s from an edge: nothing happens.
    expect(splitAt(edit, 10.05, null).edit).toBe(edit);
    // At double speed the cut lands at the right place in the file.
    const fast = setSpeed(edit, edit.clips[0]!.id, 2);
    expect(splitAt(fast, 1, null).edit.clips[0]).toMatchObject({ start: 0, end: 2 });
    // A fade doesn't appear in the middle.
    const faded = patchClip(edit, edit.clips[0]!.id, { fadeIn: 1, fadeOut: 1 });
    const parts = splitAt(faded, 5, null).edit.clips;
    expect([parts[0]!.fadeIn, parts[0]!.fadeOut, parts[1]!.fadeIn, parts[1]!.fadeOut]).toEqual([1, 0, 0, 1]);
  });

  it("splits the selected text or sound instead, when the playhead is inside it", () => {
    const { edit, id } = addText(sample(), 3);
    const cut = splitAt(edit, 4, { kind: "text", id: id! });
    expect(cut.edit.texts.map((t) => [t.at, t.duration])).toEqual([[3, 1], [4, 2]]);
    expect(cut.edit.clips).toHaveLength(3);
    const sound = splitAt(edit, 12, { kind: "audio", id: edit.audio[0]!.id }).edit.audio;
    expect(sound.map((a) => [a.at, a.start, a.end])).toEqual([[2, 0, 10], [12, 10, 30]]);
    // Outside the text: the clip under the playhead is cut.
    expect(splitAt(edit, 12, { kind: "text", id: id! }).edit.clips).toHaveLength(4);
  });

  it("trims a clip's edges within its file, and a photo up to a minute", () => {
    const edit = sample();
    const [a, , p] = edit.clips;
    expect(trimClip(edit, a!.id, "end", 7).clips[0]).toMatchObject({ start: 0, end: 7 });
    expect(trimClip(edit, a!.id, "end", 99).clips[0]!.end).toBe(10);
    expect(trimClip(edit, a!.id, "start", 3).clips[0]).toMatchObject({ start: 3, end: 10 });
    expect(trimClip(edit, a!.id, "start", 99).clips[0]!.start).toBeCloseTo(9.9);
    expect(trimClip(edit, a!.id, "start", -5).clips[0]!.start).toBe(0);
    // The photo starts at 16 s: its right edge at 26 s makes it 10 s long, and it stops at a minute.
    expect(trimClip(edit, p!.id, "end", 26).clips[2]!.end).toBe(10);
    expect(trimClip(edit, p!.id, "end", 999).clips[2]!.end).toBe(60);
    expect(trimClip(edit, p!.id, "start", 18).clips[2]).toMatchObject({ start: 0, end: 2 });
    expect(trimClip(edit, "nope", "end", 1)).toBe(edit);
  });

  it("moves and trims text and sounds freely", () => {
    const { edit, id } = addText(sample(), 3);
    const text = { kind: "text" as const, id: id! };
    const sound = { kind: "audio" as const, id: edit.audio[0]!.id };
    expect(moveOverlay(edit, text, -4).texts[0]!.at).toBe(0);
    expect(trimOverlay(edit, text, "end", 10).texts[0]).toMatchObject({ at: 3, duration: 7 });
    expect(trimOverlay(edit, text, "start", 5).texts[0]).toMatchObject({ at: 5, duration: 1 });
    // A text can outlast the video (what's past the end isn't exported), and its start stays put while its end is pulled.
    expect(trimOverlay(edit, text, "end", 500).texts[0]).toMatchObject({ at: 3, duration: 497 });
    // By hand, text is made as small and as large as the edit allows, no further.
    expect(patchText(edit, id!, { size: TEXT_SIZE.min }).texts[0]!.size).toBe(TEXT_SIZE.min);
    expect(editSchema.safeParse(patchText(patchText(edit, id!, { size: TEXT_SIZE.max }), id!, { duration: 497 })).success).toBe(true);
    // The sound's left edge moves in time and in the file together.
    expect(trimOverlay(edit, sound, "start", 6).audio[0]).toMatchObject({ at: 6, start: 4, end: 30 });
    expect(trimOverlay(edit, sound, "start", -9).audio[0]).toMatchObject({ at: 2, start: 0 });
    expect(trimOverlay(edit, sound, "end", 999).audio[0]!.end).toBe(30);
    expect(audioLength(trimOverlay(edit, sound, "end", 7).audio[0]!)).toBe(5);
  });

  it("reorders, duplicates and removes", () => {
    const edit = sample();
    const ids = edit.clips.map((c) => c.id);
    expect(moveClip(edit, ids[2]!, 0).clips.map((c) => c.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(moveClip(edit, ids[0]!, 0)).toBe(edit);
    const copy = duplicateItem(edit, { kind: "clip", id: ids[1]! });
    expect(copy.edit.clips.map((c) => c.mediaId)).toEqual(["a", "b", "b", "p"]);
    expect(copy.selection!.id).not.toBe(ids[1]);
    expect(removeItem(edit, { kind: "clip", id: ids[0]! }).clips).toHaveLength(2);
    expect(removeItem(edit, { kind: "audio", id: edit.audio[0]!.id }).audio).toHaveLength(0);
    expect(duplicateItem(edit, { kind: "audio", id: edit.audio[0]!.id }).edit.audio[1]!.at).toBe(32);
  });

  it("cuts ranges out and closes the gaps, taking text along and leaving music", () => {
    const { edit } = addText(sample(), 12);
    const cut = rippleDelete(edit, [{ start: 2, end: 4 }, { start: 3, end: 5 }, { start: 9, end: 11 }]);
    // 0-2 and 5-9 of the first video, 1-6 of the second, the photo.
    expect(cut.clips.map((c) => [c.mediaId, c.start, c.end])).toEqual([["a", 0, 2], ["a", 5, 9], ["b", 1, 6], ["p", 0, 4]]);
    expect(totalDuration(cut)).toBe(15);
    // 5 s were cut before the text.
    expect(cut.texts[0]!.at).toBe(7);
    expect(cut.audio).toEqual(edit.audio);
    expect(mergeRanges([{ start: 3, end: 5 }, { start: 1, end: 3.5 }, { start: 8, end: 8 }])).toEqual([{ start: 1, end: 5 }]);
    expect(rippleDelete(edit, [])).toBe(edit);
  });

  it("fades, zooms and animates text by the moment", () => {
    expect([fade(0, 10, 2, 0), fade(1, 10, 2, 0), fade(5, 10, 2, 2), fade(9, 10, 2, 2), fade(10, 10, 0, 2)]).toEqual([0, 0.5, 1, 0.5, 0]);
    expect(fade(3, 10, 0, 0)).toBe(1);
    const clip = { ...clipOf(video("a", 10)), motion: "in" as const };
    expect(motionScale(clip, 0)).toBe(1);
    expect(motionScale(clip, 10)).toBeCloseTo(1.14);
    expect(motionScale({ ...clip, motion: "out" }, 10)).toBeCloseTo(1);
    const { edit, id } = addText(newEdit(), 1, "Hello");
    const layer = { ...edit.texts.find((t) => t.id === id)!, duration: 3 };
    expect(textPose({ ...layer, animation: "none" }, 1)).toEqual({ alpha: 1, scale: 1, dy: 0, chars: null });
    expect(textPose({ ...layer, animation: "pop" }, 1).scale).toBeCloseTo(0.6, 1);
    expect(textPose({ ...layer, animation: "pop" }, 2.5)).toMatchObject({ alpha: 1, scale: 1 });
    expect(textPose({ ...layer, animation: "fade" }, 1).alpha).toBe(0);
    expect(textPose({ ...layer, animation: "rise" }, 1).dy).toBeGreaterThan(0.5);
    expect(textPose({ ...layer, animation: "type" }, 1).chars).toBe(0);
    expect(textPose({ ...layer, animation: "type" }, 2).chars).toBe(5);
    expect(textPose({ ...layer, animation: "fade" }, 4).alpha).toBe(0);
  });

  it("snaps to the ends of things, and stacks overlapping items in rows", () => {
    const edit = sample();
    expect(snapPoints(edit).sort((a, b) => a - b)).toEqual([0, 0, 2, 10, 10, 16, 16, 20, 32]);
    expect(snap(9.9, [0, 10, 16], 0.2)).toBe(10);
    expect(snap(9.5, [0, 10, 16], 0.2)).toBe(9.5);
    const rows = rowsOf([{ id: "x", at: 0, length: 5 }, { id: "y", at: 2, length: 2 }, { id: "z", at: 5, length: 1 }]);
    expect([rows.get("x"), rows.get("y"), rows.get("z")]).toEqual([0, 1, 0]);
  });

  it("says why an edit can't be exported", () => {
    expect(exportProblem(newEdit())).toMatch(/Add a video/);
    expect(exportProblem(sample())).toBeNull();
    expect(exportProblem(addMedia(newEdit(), [video("long", 3600)]))).toMatch(/10 minutes/);
  });

  it("builds a filter from a look and its adjustments, and reads the clock", () => {
    const clip = clipOf(video("a", 10));
    expect(lookFilter(clip)).toBe("");
    expect(lookFilter({ ...clip, look: "mono", brightness: 0.2 })).toBe("grayscale(1) contrast(1.1) brightness(1.100)");
    expect(lookFilter({ ...clip, saturation: -1 })).toBe("saturate(0.000)");
    expect([clock(0), clock(65.34), clock(65.34, false)]).toEqual(["0:00.0", "1:05.3", "1:05"]);
  });
});

describe("removing silences", () => {
  /** 10 s at 50 values a second: loud, except 2-4 s and 7-7.3 s. */
  const values = Float32Array.from({ length: 500 }, (_, i) => ((i >= 100 && i < 200) || (i >= 350 && i < 365) ? 0.002 : 0.5));
  const envelope = { rate: 50, values };

  it("finds the quiet stretches, padded so words aren't clipped", () => {
    expect(loudLevel(values)).toBe(0.5);
    expect(silences(envelope, SILENCE_PRESETS.normal)).toEqual([{ start: 2.12, end: 3.88 }]);
    // Tight catches the short gap too.
    expect(silences(envelope, SILENCE_PRESETS.tight)).toHaveLength(2);
    expect(silences({ rate: 50, values: new Float32Array(500) }, SILENCE_PRESETS.normal)).toEqual([]);
  });

  it("turns them into cuts on the timeline, clip by clip", () => {
    const edit = addMedia(newEdit(), [video("a", 10), video("b", 6)]);
    const envelopes = new Map([["a", envelope]]);
    const cuts = silenceCuts(edit, envelopes, SILENCE_PRESETS.normal);
    expect(cuts.ranges).toEqual([{ start: 2.12, end: 3.88 }]);
    expect(cuts.seconds).toBeCloseTo(1.76);
    expect(totalDuration(rippleDelete(edit, cuts.ranges))).toBeCloseTo(14.24);
    // A clip trimmed to start inside the silence is cut from its first frame; at double speed the cut is half as long.
    const trimmed = setSpeed(patchClip(edit, edit.clips[0]!.id, { start: 3 }), edit.clips[0]!.id, 2);
    const fast = silenceCuts(trimmed, envelopes, SILENCE_PRESETS.normal).ranges;
    expect(fast).toHaveLength(1);
    expect([fast[0]!.start, Number(fast[0]!.end.toFixed(3))]).toEqual([0, 0.44]);
    // Muted clips and clips that are quiet throughout are left alone.
    expect(silenceCuts(patchClip(edit, edit.clips[0]!.id, { muted: true }), envelopes, SILENCE_PRESETS.normal).ranges).toEqual([]);
    const quiet = { rate: 50, values: Float32Array.from({ length: 500 }, (_, i) => (i < 10 ? 0.5 : 0.001)) };
    expect(silenceCuts(edit, new Map([["a", quiet]]), SILENCE_PRESETS.normal).ranges).toEqual([]);
  });

  it("measures an envelope from samples", () => {
    const samples = Float32Array.from({ length: 4800 }, (_, i) => (i < 2400 ? 0.25 : -0.75));
    const env = envelopeOf(samples, 48000, 50);
    expect(env).toHaveLength(5);
    expect([env[0], env[1], env[2], env[4]]).toEqual([0.25, 0.25, 0.75, 0.75]);
  });
});
