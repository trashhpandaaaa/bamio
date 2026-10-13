import { describe, expect, it } from "vitest";
import { cutToBeat, detectBeats, timelineBeats } from "@/lib/editor/beats";
import { captionAt, captionLines, lineText, PIECE_GAP, retypeLine, soundPlan, wordsToMedia } from "@/lib/editor/captions";
import { editFromClip } from "@/lib/editor/from-clip";
import { applyLayout, camCrop, layoutOf, setCamCorner } from "@/lib/editor/layouts";
import { blocksOf, integratedLoudness, levelGain } from "@/lib/editor/loudness";
import { captionsOf, editSchema, newEdit, type CaptionWord, type Edit, type Media } from "@/lib/editor/model";
import { offsetFor, reframeTrack, visibleShare } from "@/lib/editor/reframe";
import {
  addMedia,
  addOverlay,
  duplicateItem,
  freezeAt,
  layout,
  momentAt,
  moveOverlay,
  overlayMomentAt,
  patchAudio,
  patchClip,
  removeItem,
  rippleDelete,
  snapPoints,
  splitAt,
  swapMedia,
  totalDuration,
  trackAt,
  transitionAt,
  trimClip,
  trimOverlay,
} from "@/lib/editor/timeline";

/* The editor's new features: the arithmetic behind each, without a browser. */

const video = (id: string, duration: number, width = 1920, height = 1080): Media => ({ id, kind: "video", name: `${id}.mp4`, size: 1000, duration, width, height, hasAudio: true });
const photo: Media = { id: "p", kind: "image", name: "logo.png", size: 10, duration: 0, width: 400, height: 200, hasAudio: false };
const song: Media = { id: "s", kind: "audio", name: "s.mp3", size: 10, duration: 30, width: 0, height: 0, hasAudio: true };

/** Two videos (10 s and 6 s) on the main track. */
const sample = (): Edit => addMedia(newEdit("Test", 1), [video("a", 10), video("b", 6)]);

describe("edits saved before these features", () => {
  it("still open, with no layers and nothing else new", () => {
    const old = { ...sample() } as Record<string, unknown>;
    delete old.overlays;
    const parsed = editSchema.parse(old);
    expect(parsed.overlays).toEqual([]);
    expect(parsed.captions).toBeUndefined();
    expect(parsed.clips[0]!.transition).toBeUndefined();
  });
});

describe("freeze frames", () => {
  it("split the clip and hold the frame at the cut, silent, for two seconds", () => {
    const edit = sample();
    const { edit: frozen, id } = freezeAt(edit, 4);
    expect(frozen.clips.map((c) => [c.mediaId, c.start, c.end, Boolean(c.freeze)])).toEqual([
      ["a", 0, 4, false],
      ["a", 4, 6, true],
      ["a", 4, 10, false],
      ["b", 0, 6, false],
    ]);
    expect(totalDuration(frozen)).toBe(18);
    // Whatever the moment inside it, it shows its one frame.
    expect(momentAt(frozen, 4.5)).toMatchObject({ source: 4, clip: { id } });
    expect(momentAt(frozen, 5.9)).toMatchObject({ source: 4 });
    // Trimmed like a photo: its length changes, never its frame.
    const longer = trimClip(frozen, id!, "end", 9);
    expect(longer.clips[1]).toMatchObject({ start: 4, end: 9 });
    const shorter = trimClip(frozen, id!, "start", 5);
    expect(shorter.clips[1]).toMatchObject({ start: 4, end: 5 });
    // Not on a photo, or on a freeze frame.
    expect(freezeAt(addMedia(newEdit("P", 1), [photo]), 1).id).toBeNull();
    expect(freezeAt(frozen, 5).id).toBeNull();
    expect(editSchema.safeParse(frozen).success).toBe(true);
  });
});

describe("transitions", () => {
  it("play over the start of the clip they come into, never longer than half of either clip", () => {
    const edit = patchClip(sample(), sample().clips[1]!.id, {});
    const into = patchClip(edit, edit.clips[1]!.id, { transition: { kind: "fade", sec: 0.5 } });
    expect(transitionAt(into, momentAt(into, 9.9)!)).toBeNull();
    const halfway = transitionAt(into, momentAt(into, 10.25)!);
    expect(halfway).toMatchObject({ transition: { kind: "fade" }, progress: 0.5, previous: { clip: { id: into.clips[0]!.id }, from: 0, to: 10 } });
    expect(transitionAt(into, momentAt(into, 10.6)!)).toBeNull();
    // The length of the edit doesn't change.
    expect(totalDuration(into)).toBe(16);
    // A two-second transition into a clip half a second long lasts a quarter of a second.
    const short = patchClip(trimClip(into, into.clips[1]!.id, "end", 10.5), into.clips[1]!.id, { transition: { kind: "slide", sec: 2 } });
    expect(transitionAt(short, momentAt(short, 10.3)!)).toBeNull();
    expect(transitionAt(short, momentAt(short, 10.1)!)?.progress).toBeCloseTo(0.4);
    // The first clip has nothing to come from; a split's second half doesn't inherit it.
    expect(transitionAt(patchClip(into, into.clips[0]!.id, { transition: { kind: "fade", sec: 1 } }), momentAt(into, 0.2)!)).toBeNull();
    const split = splitAt(into, 13, null);
    expect(split.edit.clips[2]!.transition).toBeUndefined();
    expect(split.edit.clips[1]!.transition).toEqual({ kind: "fade", sec: 0.5 });
  });
});

describe("layers", () => {
  it("lay a picture over the main track, and move, trim, split, copy and delete like the rest", () => {
    const { edit, id } = addOverlay(sample(), photo, 2);
    const layer = edit.overlays[0]!;
    expect(layer).toMatchObject({ id, mediaId: "p", at: 2, start: 0, end: 4, crop: { x: 0, y: 0, w: 1, h: 1 }, muted: true });
    expect(edit.media.map((m) => m.id)).toContain("p");
    // A third of a 9:16 frame's width, as tall as a 2:1 picture is there.
    expect(layer.box.w).toBeCloseTo(0.34);
    expect(layer.box.h).toBeCloseTo((0.34 * 1080) / 2 / 1920);
    const sel = { kind: "overlay" as const, id: id! };
    expect(overlayMomentAt(layer, 1.9)).toBeNull();
    expect(overlayMomentAt(layer, 3)).toEqual({ local: 1, source: 1 });
    expect(moveOverlay(edit, sel, 5).overlays[0]!.at).toBe(5);
    // A picture's left edge changes its length; its end stays put.
    expect(trimOverlay(edit, sel, "start", 3).overlays[0]).toMatchObject({ at: 3, start: 0, end: 3 });
    expect(trimOverlay(edit, sel, "end", 10).overlays[0]).toMatchObject({ at: 2, end: 8 });
    const split = splitAt(edit, 4, sel);
    expect(split.edit.overlays.map((o) => [o.at, o.start, o.end])).toEqual([[2, 0, 2], [4, 0, 2]]);
    expect(duplicateItem(edit, sel).edit.overlays.map((o) => o.at)).toEqual([2, 6]);
    expect(removeItem(edit, sel).overlays).toEqual([]);
    expect(snapPoints(edit)).toEqual(expect.arrayContaining([2, 6]));
    // A video's left edge moves in time and in the file together.
    const vid = addOverlay(sample(), video("c", 20), 1);
    const moved = trimOverlay(vid.edit, { kind: "overlay", id: vid.id! }, "start", 3);
    expect(moved.overlays[0]).toMatchObject({ at: 3, start: 2, end: 20 });
    // Cutting the main track moves layers to where their start went.
    expect(rippleDelete(vid.edit, [{ start: 0, end: 0.5 }]).overlays[0]!.at).toBe(0.5);
    expect(editSchema.safeParse(edit).success).toBe(true);
  });
});

describe("layouts", () => {
  it("put a facecam on top from the clip itself, and a split screen or picture-in-picture from another file", () => {
    const edit = sample();
    const ids = [edit.clips[0]!.id];
    const facecam = applyLayout(edit, ids, "facecam").edit;
    expect(facecam.clips[0]).toMatchObject({ box: { x: 0, y: 0.36, w: 1, h: 0.64 }, cam: { crop: camCrop("tl"), box: { x: 0, y: 0, w: 1, h: 0.36 } } });
    expect(facecam.clips[1]!.cam).toBeUndefined();
    expect(layoutOf(facecam, facecam.clips[0]!)).toBe("facecam");
    expect(camCrop("br")).toEqual({ x: 0.72, y: 0.64, w: 0.28, h: 0.36 });
    // Back to the full frame.
    const full = applyLayout(facecam, ids, "full").edit;
    expect(full.clips[0]!.box).toBeUndefined();
    expect(full.clips[0]!.cam).toBeUndefined();

    const split = applyLayout(edit, ids, "split", video("other", 30));
    expect(split.edit.clips[0]!.box).toEqual({ x: 0, y: 0, w: 1, h: 0.5 });
    expect(split.edit.overlays[0]).toMatchObject({ id: split.overlayId, mediaId: "other", at: 0, start: 0, end: 10, box: { x: 0, y: 0.5, w: 1, h: 0.5 } });
    expect(layoutOf(split.edit, split.edit.clips[0]!)).toBe("split");
    // The other file shorter than the clip: as long as it is.
    expect(applyLayout(edit, ids, "split", video("short", 4)).edit.overlays[0]!.end).toBe(4);

    const pip = applyLayout(edit, ids, "pip", video("other", 30));
    expect(pip.edit.clips[0]!.box).toBeUndefined();
    expect(pip.edit.overlays[0]).toMatchObject({ border: true, radius: 0.12 });
    expect(layoutOf(pip.edit, pip.edit.clips[0]!)).toBe("pip");
    expect(editSchema.safeParse(split.edit).success).toBe(true);
  });
});

describe("captions", () => {
  const words: CaptionWord[] = [
    { text: "so", start: 1, end: 1.2 },
    { text: "this", start: 1.2, end: 1.5 },
    { text: "is", start: 1.5, end: 1.6 },
    { text: "the", start: 1.6, end: 1.7 },
    { text: "moment", start: 1.7, end: 2.2 },
    { text: "later", start: 4, end: 4.5 },
  ];

  it("group words into lines by style, breaking at pauses", () => {
    expect(captionLines(words, "pop").map((l) => lineText(l.words))).toEqual(["so this is", "the moment", "later"]);
    expect(captionLines(words, "clean").map((l) => lineText(l.words))).toEqual(["so this is the moment", "later"]);
    // A line stays half a second after its last word, unless the next starts sooner.
    const lines = captionLines(words, "pop");
    expect(lines[0]).toMatchObject({ start: 1, end: 1.6 });
    expect(lines[1]).toMatchObject({ start: 1.6, end: 2.7 });
  });

  it("follow the words through cuts and speed changes, and come from a voiceover when the clip has none", () => {
    let edit = sample();
    edit = { ...edit, captions: captionsOf({ a: words }) };
    expect(captionAt(edit, 1.3)).toMatchObject({ mediaId: "a", active: 1 });
    expect(lineText(captionAt(edit, 1.3)!.words)).toBe("so this is");
    // Twice as fast: the same words, at half the time.
    const fast = patchClip(edit, edit.clips[0]!.id, { speed: 2 });
    expect(lineText(captionAt(fast, 0.85)!.words)).toBe("the moment");
    // Cut the first second out: the words follow what's said.
    const cut = rippleDelete(edit, [{ start: 0, end: 1 }]);
    expect(lineText(captionAt(cut, 0.3)!.words)).toBe("so this is");
    // Words cut out of the clip don't show: from 1.55 s of the file, the first line is down to the word said then.
    const trimmed = trimClip(edit, edit.clips[0]!.id, "start", 1.55);
    expect(lineText(captionAt(trimmed, 0.01)?.words ?? [])).toBe("is");
    expect(lineText(captionAt(trimmed, 0.1)?.words ?? [])).toBe("the moment");
    // Off, muted or a freeze frame: nothing.
    expect(captionAt({ ...edit, captions: { ...edit.captions!, on: false } }, 1.3)).toBeNull();
    expect(captionAt(patchClip(edit, edit.clips[0]!.id, { muted: true }), 1.3)).toBeNull();
    // A voiceover's words, over a clip with none.
    const voiced = addMedia({ ...edit, captions: captionsOf({ s: [{ text: "hello", start: 0.5, end: 1 }] }) }, [song], 12);
    expect(captionAt(voiced, 12.6)).toMatchObject({ mediaId: "s", active: 0 });
    expect(captionAt(voiced, 30)).toBeNull();
    expect(editSchema.safeParse(voiced).success).toBe(true);
  });

  it("are typed over a line at a time", () => {
    const [first] = captionLines(words, "pop");
    // The same number of words keep their times.
    const fixed = retypeLine(words, first!, "So that's  it");
    expect(fixed.slice(0, 3)).toEqual([
      { text: "So", start: 1, end: 1.2 },
      { text: "that's", start: 1.2, end: 1.5 },
      { text: "it", start: 1.5, end: 1.6 },
    ]);
    // A different number share the line's time out.
    const more = retypeLine(words, first!, "a b c d");
    expect(more.slice(0, 4).map((w) => w.text)).toEqual(["a", "b", "c", "d"]);
    expect(more[0]!.start).toBe(1);
    expect(more[3]!.end).toBeCloseTo(1.6);
    // Nothing typed removes it.
    expect(retypeLine(words, first!, "  ").map((w) => w.text)).toEqual(["the", "moment", "later"]);
  });
});

describe("cut to the beat", () => {
  /** Clicks every half second (120 a minute) over a little noise, as music's kick would be. */
  function clicks(seconds: number, rate = 16_000, every = 0.5, offset = 0.13): Float32Array {
    const out = new Float32Array(seconds * rate);
    let seed = 7;
    for (let i = 0; i < out.length; i++) {
      seed = (seed * 16807) % 2147483647;
      out[i] = ((seed / 2147483647) * 2 - 1) * 0.01;
    }
    for (let t = offset; t < seconds; t += every) {
      for (let i = 0; i < rate * 0.05; i++) {
        const at = Math.round(t * rate) + i;
        if (at < out.length) out[at] = out[at]! + Math.sin((2 * Math.PI * 60 * i) / rate) * Math.exp(-i / (rate * 0.012));
      }
    }
    return out;
  }

  it("finds the tempo and the beats of music", () => {
    const found = detectBeats(clicks(20), 16_000);
    expect(found.bpm).toBeGreaterThan(118);
    expect(found.bpm).toBeLessThan(122);
    expect(found.beats.length).toBeGreaterThan(36);
    // On the clicks, within a hundredth or two.
    for (const beat of found.beats.slice(2, 10)) {
      const beatsIn = (beat - 0.13) / 0.5;
      expect(Math.abs(beatsIn - Math.round(beatsIn))).toBeLessThan(0.06);
    }
    // Silence has no beat.
    expect(detectBeats(new Float32Array(16_000 * 10), 16_000)).toEqual({ bpm: 0, beats: [] });
  });

  it("puts each cut on the beat nearest it, as far as the files allow", () => {
    let edit = addMedia(sample(), [song], 0);
    edit = patchAudio(edit, edit.audio[0]!.id, { beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10.2, 11, 12, 13, 14, 15, 15.9, 16.7] });
    const beats = timelineBeats(edit);
    expect(beats[0]).toBe(0.5);
    const fitted = cutToBeat(edit, beats);
    const ends = layout(fitted).map((p) => p.to);
    // The first clip (10 s) ends on 9.5: 10.2 would need more of its file than there is.
    expect(ends[0]).toBe(9.5);
    // The second (6 s from 9.5) wants to end at 15.5: 15.9 is nearer, but the file ends first, so 15.
    expect(ends[1]).toBe(15);
    expect(fitted.clips[1]!.end).toBeCloseTo(5.5);
    // No beats: as it was.
    expect(cutToBeat(edit, [])).toBe(edit);
    // Snapping knows the beats too.
    expect(snapPoints(edit)).toEqual(expect.arrayContaining([0.5, 10.2]));
  });
});

describe("auto-reframe", () => {
  it("knows how much room there is, and where to put a point in the middle", () => {
    const clip = { zoom: 1, rotate: 0 as const };
    // A 16:9 picture filling a 9:16 frame shows under a third of its width, and all of its height.
    const v = visibleShare(clip, { width: 1920, height: 1080 }, { width: 1080, height: 1920 });
    expect(v.x).toBeCloseTo(0.3164, 3);
    expect(v.y).toBe(1);
    expect(offsetFor(0.5, v.x)).toBe(0);
    expect(offsetFor(0, v.x)).toBe(-1);
    expect(offsetFor(0.2, v.x)).toBeCloseTo((0.2 - 0.5) / ((1 - v.x) / 2));
    expect(offsetFor(0.9, 1)).toBe(0);
  });

  it("follows a face without jitter, holds through gaps, and eases to where it moved", () => {
    const visible = { x: 0.32, y: 1 };
    const samples = [
      { t: 0, cx: null, cy: null },
      { t: 0.25, cx: 0.3, cy: 0.4 },
      { t: 0.5, cx: 0.31, cy: 0.41 },
      { t: 0.75, cx: 0.29, cy: 0.4 },
      { t: 1, cx: null, cy: null },
      ...Array.from({ length: 12 }, (_, i) => ({ t: 1.25 + i * 0.25, cx: 0.75, cy: 0.4 })),
    ];
    const track = reframeTrack(samples, visible);
    expect(track).toHaveLength(samples.length);
    // Before the first face: where the first face is.
    expect(track[0]!.x).toBeCloseTo(offsetFor(0.3, 0.32), 2);
    // Small wobbles don't move it.
    expect(track[1]!.x).toBe(track[3]!.x);
    // Through the gap it holds; then it eases over, without jumping.
    expect(track[4]!.x).toBe(track[3]!.x);
    expect(track[5]!.x).toBeGreaterThan(track[4]!.x);
    expect(track[5]!.x).toBeLessThan(offsetFor(0.75, 0.32));
    expect(track.at(-1)!.x).toBeCloseTo(offsetFor(0.75, 0.32), 1);
    // No faces at all: no path.
    expect(reframeTrack([{ t: 0, cx: null, cy: null }], visible)).toEqual([]);
    // The picture follows the path between its points.
    expect(trackAt(track, 0.125).x).toBeCloseTo((track[0]!.x + track[1]!.x) / 2);
    expect(trackAt([], 3)).toEqual({ x: 0, y: 0 });
  });
});

describe("loudness levelling", () => {
  it("measures integrated loudness with the standard's gates, and turns it to -14 LUFS", () => {
    // A steady tone whose K-weighted mean square is 0.01: about -20.7 LUFS.
    const steady = blocksOf(Array.from({ length: 100 }, () => 0.01));
    expect(steady).toHaveLength(97);
    expect(integratedLoudness(steady)).toBeCloseTo(-20.691, 2);
    // Silence in the middle is gated out.
    expect(integratedLoudness([...steady, ...Array.from({ length: 50 }, () => 1e-9)])).toBeCloseTo(-20.691, 2);
    expect(integratedLoudness([])).toBe(-Infinity);
    expect(levelGain(-20.691)).toBeCloseTo(10 ** (6.691 / 20));
    // Never more than 12 dB up, nor for silence.
    expect(levelGain(-60)).toBeCloseTo(10 ** (12 / 20));
    expect(levelGain(-Infinity)).toBe(1);
    expect(levelGain(-6)).toBeCloseTo(10 ** (-8 / 20));
  });
});

describe("auto captions", () => {
  it("send only the parts used, padded, one after another, and the words come back in each file's seconds", () => {
    let edit = sample();
    // a: 2 to 3 and 7 to 8 used (two clips, far enough apart to go as two), b: all of it.
    const [a, b] = edit.clips;
    edit = { ...edit, clips: [{ ...a!, start: 2, end: 3 }, { ...a!, id: "a2", start: 7, end: 8 }, b!] };
    const plan = soundPlan(edit, () => true);
    const second = 1.8 + PIECE_GAP;
    const third = second + 1.8 + PIECE_GAP;
    expect(plan.pieces.map((p) => ({ ...p, start: +p.start.toFixed(3), end: +p.end.toFixed(3), at: +p.at.toFixed(3) }))).toEqual([
      { mediaId: "a", start: 1.6, end: 3.4, at: 0 },
      { mediaId: "a", start: 6.6, end: 8.4, at: +second.toFixed(3) },
      { mediaId: "b", start: 0, end: 6, at: +third.toFixed(3) },
    ]);
    expect(plan.total).toBeCloseTo(third + 6);
    const heard = [
      { text: "one", start: 0.5, end: 0.9 },
      { text: "gap", start: 1.85, end: 2.15 }, // in the silence between pieces: dropped
      { text: "two", start: second + 0.2, end: second + 0.6 },
      { text: "three", start: third + 0.7, end: third + 1 },
    ];
    const words = wordsToMedia(plan.pieces, heard);
    expect(words.a!.map((w) => [w.text, +w.start.toFixed(2)])).toEqual([
      ["one", 2.1],
      ["two", 6.8],
    ]);
    expect(words.b!.map((w) => [w.text, +w.start.toFixed(2)])).toEqual([["three", 0.7]]);
  });

  it("join parts of a file that nearly touch, and leave out freeze frames and files without sound", () => {
    let edit = sample();
    const [a] = edit.clips;
    edit = { ...edit, clips: [{ ...a!, start: 0, end: 3 }, { ...a!, id: "a2", start: 4, end: 6 }, { ...a!, id: "f", start: 5, end: 7, freeze: true }] };
    expect(soundPlan(edit, (id) => id === "a").pieces).toEqual([{ mediaId: "a", start: 0, end: 6.4, at: 0 }]);
    expect(soundPlan(edit, () => false).pieces).toEqual([]);
  });
});

describe("a Bamio clip in the editor", () => {
  const media = video("cut", 40);
  const setup = {
    title: "Best moment",
    offset: 1.5,
    duration: 30,
    aspect: "9:16" as const,
    focusX: 0.75,
    fit: "crop" as const,
    captions: { on: true, style: "boxed" as const, position: "middle" as const, words: [{ text: "hi", start: 2, end: 2.4 }], language: "en" },
    overlay: "Wait for it",
  };

  it("is framed and captioned the way the clip was", () => {
    const edit = editFromClip(setup, media, 5);
    expect(editSchema.safeParse(edit).success).toBe(true);
    expect(edit.format).toBe("9:16");
    expect(edit.clips[0]).toMatchObject({ mediaId: "cut", start: 1.5, end: 31.5, fit: "fill", x: 0.5 });
    expect(edit.captions).toMatchObject({ on: true, style: "boxed", y: 0.5, language: "en", words: { cut: [{ text: "hi", start: 2, end: 2.4 }] } });
    expect(edit.texts[0]).toMatchObject({ text: "Wait for it", y: 0.14, duration: 30 });
  });

  it("has no captions without words, and never runs past the file", () => {
    const edit = editFromClip({ ...setup, duration: 60, overlay: null, captions: { ...setup.captions, words: [] } }, media);
    expect(edit.captions).toBeUndefined();
    expect(edit.texts).toEqual([]);
    expect(edit.clips[0]!.end).toBe(40);
  });
});

describe("facecam corners and swapped files", () => {
  it("moves the facecam to another corner, giving clips one first", () => {
    const edit = sample();
    const ids = edit.clips.map((c) => c.id);
    const moved = setCamCorner(edit, ids, "br");
    for (const clip of moved.clips) expect(clip.cam?.crop).toEqual(camCrop("br"));
    expect(layoutOf(moved, moved.clips[0]!)).toBe("facecam");
  });

  it("plays a clip from another file, all of it, keeping its look", () => {
    let edit = sample();
    const id = edit.clips[0]!.id;
    edit = patchClip(edit, id, { look: "warm", track: [{ t: 0, x: 0, y: 0 }] });
    const swapped = swapMedia(edit, id, video("rev", 4));
    expect(swapped.media.map((m) => m.id)).toContain("rev");
    expect(swapped.clips[0]).toMatchObject({ mediaId: "rev", start: 0, end: 4, look: "warm" });
    expect(swapped.clips[0]!.track).toBeUndefined();
  });
});
