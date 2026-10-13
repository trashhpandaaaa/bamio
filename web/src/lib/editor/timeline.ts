import {
  audioOf,
  clipOf,
  EDITOR_LIMITS,
  FORMATS,
  newId,
  overlayOf,
  textAt,
  type AudioClip,
  type Clip,
  type Edit,
  type Media,
  type Overlay,
  type Selection,
  type TextLayer,
  type TrackPoint,
  type Transition,
} from "./model";

/*
 * The editor's arithmetic: where each clip sits on the timeline, what plays at a moment, and
 * every change to an edit (split, trim, move, delete, cut silences out). Pure functions: an
 * edit goes in, a new edit comes out, so undo is just keeping the old one.
 */

const MIN = EDITOR_LIMITS.minItemSec;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** How long a clip lasts on the timeline. */
export const clipLength = (clip: Clip) => (clip.end - clip.start) / clip.speed;
export const audioLength = (audio: AudioClip) => audio.end - audio.start;
/** How long a layer lasts on the timeline. */
export const overlayLength = (overlay: Overlay) => (overlay.end - overlay.start) / overlay.speed;

export type Placed = { clip: Clip; index: number; from: number; to: number };
/** A moment inside a clip: `local` seconds into it on the timeline, `source` seconds into its file. */
export type Moment = Placed & { local: number; source: number };

/** The main track: clips one after another from 0. */
export function layout(edit: Edit): Placed[] {
  let at = 0;
  return edit.clips.map((clip, index) => {
    const from = at;
    at += clipLength(clip);
    return { clip, index, from, to: at };
  });
}

/** The edit's length: the main track's. Text and sound past its end aren't shown or heard. */
export const totalDuration = (edit: Edit) => edit.clips.reduce((sum, clip) => sum + clipLength(clip), 0);

/** What the main track shows at `t` (its last frame at the very end, nothing when it's empty). */
export function momentAt(edit: Edit, t: number): Moment | null {
  const placed = layout(edit);
  if (placed.length === 0) return null;
  const last = placed[placed.length - 1]!;
  const time = clamp(t, 0, last.to);
  const p = placed.find((c) => time < c.to) ?? last;
  // At the very end: a frame inside the last clip, so there's a picture to show (a player has none at a file's very end).
  const local = clamp(time - p.from, 0, Math.max(0, clipLength(p.clip) - 0.04));
  // A freeze frame is its first frame all the way through.
  return { ...p, local, source: p.clip.freeze ? p.clip.start : p.clip.start + local * p.clip.speed };
}

/** The last frame a clip shows, in its file's seconds (what a transition out of it starts from). */
export const lastFrameAt = (clip: Clip) => (clip.freeze ? clip.start : Math.max(clip.start, clip.end - (1 / EDITOR_LIMITS.fps) * clip.speed));

/**
 * The transition being played at a moment: into this clip from the one before, over the clip's
 * first `sec` seconds (never more than half of either clip). `progress`: 0 to 1.
 */
export function transitionAt(edit: Edit, moment: Moment): { transition: Transition; progress: number; previous: Placed } | null {
  const transition = moment.clip.transition;
  if (!transition || moment.index === 0) return null;
  const before = edit.clips[moment.index - 1];
  if (!before) return null;
  const sec = Math.min(transition.sec, clipLength(moment.clip) / 2, clipLength(before) / 2);
  if (sec <= 0 || moment.local >= sec) return null;
  const from = moment.from - clipLength(before);
  return { transition, progress: clamp(moment.local / sec, 0, 1), previous: { clip: before, index: moment.index - 1, from, to: moment.from } };
}

/** Where a layer is at `t`: seconds into it on the timeline, and the second of its file showing. Null when it isn't showing. */
export function overlayMomentAt(overlay: Overlay, t: number): { local: number; source: number } | null {
  const local = t - overlay.at;
  const length = overlayLength(overlay);
  if (local < 0 || local >= length) return null;
  return { local, source: Math.min(overlay.end, overlay.start + local * overlay.speed) };
}

/** Where an auto-reframed picture's middle is at a second of its file: between the track's points. */
export function trackAt(track: readonly TrackPoint[], t: number): { x: number; y: number } {
  if (track.length === 0) return { x: 0, y: 0 };
  if (t <= track[0]!.t) return { x: track[0]!.x, y: track[0]!.y };
  for (let i = 1; i < track.length; i++) {
    const b = track[i]!;
    if (t > b.t) continue;
    const a = track[i - 1]!;
    const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }
  const last = track[track.length - 1]!;
  return { x: last.x, y: last.y };
}

/** How much of a picture or sound is there `local` seconds into an item `length` long: 0 to 1, ramping at each end. */
export function fade(local: number, length: number, fadeIn: number, fadeOut: number): number {
  let level = 1;
  if (fadeIn > 0) level = Math.min(level, local / Math.min(fadeIn, length));
  if (fadeOut > 0) level = Math.min(level, (length - local) / Math.min(fadeOut, length));
  return clamp(level, 0, 1);
}

/** The slow zoom of a clip's motion: its scale `local` seconds in. */
export function motionScale(clip: Clip, local: number): number {
  if (clip.motion === "none") return 1;
  const progress = clamp(local / Math.max(clipLength(clip), 1e-3), 0, 1);
  return clip.motion === "in" ? 1 + 0.14 * progress : 1.14 - 0.14 * progress;
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;
/** Overshoots a little past 1 before settling. */
const easeOutBack = (p: number) => 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2;

export type TextPose = { alpha: number; scale: number; /** Shift down, in letter heights. */ dy: number; /** How many characters show yet (null: all). */ chars: number | null };

/** How a text layer looks at `t`: its animation on the way in and out. */
export function textPose(layer: TextLayer, t: number): TextPose {
  const local = t - layer.at;
  const pose: TextPose = { alpha: 1, scale: 1, dy: 0, chars: null };
  if (layer.animation === "none") return pose;
  const enter = Math.min(0.35, layer.duration / 3);
  const leave = Math.min(0.25, layer.duration / 3);
  const p = enter > 0 ? clamp(local / enter, 0, 1) : 1;
  const q = leave > 0 ? clamp((layer.duration - local) / leave, 0, 1) : 1;
  pose.alpha = q;
  if (layer.animation === "pop") {
    pose.scale = 0.6 + 0.4 * easeOutBack(p);
    pose.alpha = Math.min(q, clamp(p * 3, 0, 1));
  } else if (layer.animation === "fade") {
    pose.alpha = Math.min(p, q);
  } else if (layer.animation === "rise") {
    pose.dy = 0.7 * (1 - easeOut(p));
    pose.alpha = Math.min(p, q);
  } else if (layer.animation === "type") {
    const length = [...layer.text].length;
    const typing = Math.min(layer.duration * 0.6, Math.max(0.3, length * 0.05));
    pose.chars = Math.min(length, Math.ceil(length * clamp(local / typing, 0, 1)));
  }
  return pose;
}

/* ------------------------------ Changes ------------------------------ */

const mediaOf = (edit: Edit, id: string) => edit.media.find((m) => m.id === id);
const touch = (edit: Edit, patch: Partial<Edit>): Edit => ({ ...edit, ...patch, updatedAt: Date.now() });

/** Add files to the edit: videos and photos go on the end of the main track, sounds start at `at`. */
export function addMedia(edit: Edit, media: Media[], at = 0): Edit {
  const known = new Set(edit.media.map((m) => m.id));
  const clips = [...edit.clips];
  const audio = [...edit.audio];
  for (const m of media) {
    if (m.kind === "audio") {
      if (audio.length < EDITOR_LIMITS.maxAudio) audio.push(audioOf(m, at));
    } else if (clips.length < EDITOR_LIMITS.maxClips) clips.push(clipOf(m));
  }
  return touch(edit, { media: [...edit.media, ...media.filter((m) => !known.has(m.id))], clips, audio });
}

export function addText(edit: Edit, at: number, text?: string): { edit: Edit; id: string | null } {
  if (edit.texts.length >= EDITOR_LIMITS.maxTexts) return { edit, id: null };
  const layer = textAt(Math.max(0, at), text);
  return { edit: touch(edit, { texts: [...edit.texts, layer] }), id: layer.id };
}

export const patchClip = (edit: Edit, id: string, patch: Partial<Clip>) => touch(edit, { clips: edit.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
export const patchText = (edit: Edit, id: string, patch: Partial<TextLayer>) => touch(edit, { texts: edit.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
export const patchAudio = (edit: Edit, id: string, patch: Partial<AudioClip>) => touch(edit, { audio: edit.audio.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
export const patchOverlay = (edit: Edit, id: string, patch: Partial<Overlay>) => touch(edit, { overlays: edit.overlays.map((o) => (o.id === id ? { ...o, ...patch } : o)) });

/** Lay a picture or a video over the main track from `at`. Returns the edit and the new layer's id (null at the limit). */
export function addOverlay(edit: Edit, media: Media, at: number): { edit: Edit; id: string | null } {
  if (edit.overlays.length >= EDITOR_LIMITS.maxOverlays || media.kind === "audio") return { edit, id: null };
  const overlay = overlayOf(media, Math.max(0, at), FORMATS[edit.format]);
  const known = edit.media.some((m) => m.id === media.id);
  return { edit: touch(edit, { media: known ? edit.media : [...edit.media, media], overlays: [...edit.overlays, overlay] }), id: overlay.id };
}

/**
 * A freeze frame at `t`: the clip there is split, and the frame at the cut holds for
 * `sec` seconds between the two halves. Returns the edit and the freeze frame's id.
 */
export function freezeAt(edit: Edit, t: number, sec: number = EDITOR_LIMITS.freezeSec): { edit: Edit; id: string | null } {
  const placed = layout(edit).find((p) => t >= p.from && t < p.to) ?? layout(edit).at(-1);
  if (!placed || edit.clips.length + 2 > EDITOR_LIMITS.maxClips) return { edit, id: null };
  const { clip } = placed;
  if (mediaOf(edit, clip.mediaId)?.kind !== "video" || clip.freeze) return { edit, id: null };
  const cut = clamp(clip.start + (t - placed.from) * clip.speed, clip.start, lastFrameAt(clip));
  const still: Clip = { ...clip, id: newId(), start: cut, end: cut + sec * clip.speed, freeze: true, fadeIn: 0, fadeOut: 0, transition: undefined, track: undefined };
  const before = cut - clip.start >= MIN * clip.speed ? [{ ...clip, end: cut, fadeOut: 0 }] : [];
  const after = clip.end - cut >= MIN * clip.speed ? [{ ...clip, id: newId(), start: cut, fadeIn: 0, transition: undefined }] : [];
  const clips = edit.clips.flatMap((c) => (c.id === clip.id ? [...before, still, ...after] : [c]));
  return { edit: touch(edit, { clips }), id: still.id };
}

/**
 * A clip played from another file instead, all of it (a reversed copy of its part): the file
 * joins the edit, and the clip keeps its look, framing and place. A path to follow belonged to
 * the old file's seconds, so it goes.
 */
export function swapMedia(edit: Edit, id: string, media: Media): Edit {
  const known = edit.media.some((m) => m.id === media.id);
  return touch(edit, {
    media: known ? edit.media : [...edit.media, media],
    clips: edit.clips.map((c) => (c.id === id ? { ...c, mediaId: media.id, start: 0, end: media.duration, freeze: undefined, track: undefined } : c)),
  });
}

/** A clip's speed, keeping what it shows: its length on the timeline changes instead. */
export function setSpeed(edit: Edit, id: string, speed: number): Edit {
  return patchClip(edit, id, { speed: clamp(speed, EDITOR_LIMITS.minSpeed, EDITOR_LIMITS.maxSpeed) });
}

/**
 * Drag one edge of a main-track clip to the timeline position `to`. The clip can't grow past
 * its file (a photo can last up to a minute) or shrink below a tenth of a second.
 */
export function trimClip(edit: Edit, id: string, edge: "start" | "end", to: number): Edit {
  const placed = layout(edit).find((p) => p.clip.id === id);
  if (!placed) return edit;
  const { clip } = placed;
  const media = mediaOf(edit, clip.mediaId);
  const still = media?.kind === "image" || Boolean(clip.freeze);
  const longest = still ? clip.start + 60 * clip.speed : (media?.duration ?? clip.end);
  const least = MIN * clip.speed;
  if (edge === "end") {
    const end = clamp(clip.start + (to - placed.from) * clip.speed, clip.start + least, longest);
    return patchClip(edit, id, { end });
  }
  const moved = (to - placed.from) * clip.speed;
  // A photo or a freeze frame has no "earlier": pulling its left edge only makes it shorter or longer.
  if (still) return patchClip(edit, id, { end: clamp(clip.end - moved, clip.start + least, longest) });
  return patchClip(edit, id, { start: clamp(clip.start + moved, 0, clip.end - least) });
}

/** Drag one edge of a text layer or a sound to the timeline position `to`. */
export function trimOverlay(edit: Edit, selection: NonNullable<Selection>, edge: "start" | "end", to: number): Edit {
  if (selection.kind === "text") {
    const layer = edit.texts.find((t) => t.id === selection.id);
    if (!layer) return edit;
    const end = layer.at + layer.duration;
    if (edge === "end") return patchText(edit, layer.id, { duration: Math.max(MIN, to - layer.at) });
    const at = clamp(to, 0, end - MIN);
    return patchText(edit, layer.id, { at, duration: end - at });
  }
  if (selection.kind === "audio") {
    const sound = edit.audio.find((a) => a.id === selection.id);
    if (!sound) return edit;
    const longest = mediaOf(edit, sound.mediaId)?.duration ?? sound.end;
    if (edge === "end") return patchAudio(edit, sound.id, { end: clamp(sound.start + (to - sound.at), sound.start + MIN, longest) });
    // The left edge moves in time and in the file together, so the rest stays where it was heard.
    const moved = clamp(to - sound.at, -sound.start, audioLength(sound) - MIN);
    return patchAudio(edit, sound.id, { at: Math.max(0, sound.at + moved), start: sound.start + moved });
  }
  if (selection.kind === "overlay") {
    const layer = edit.overlays.find((o) => o.id === selection.id);
    if (!layer) return edit;
    const picture = mediaOf(edit, layer.mediaId)?.kind === "image";
    const longest = picture ? 3600 : (mediaOf(edit, layer.mediaId)?.duration ?? layer.end);
    const least = MIN * layer.speed;
    if (edge === "end") return patchOverlay(edit, layer.id, { end: clamp(layer.start + (to - layer.at) * layer.speed, layer.start + least, longest) });
    if (picture) {
      const end = layer.at + overlayLength(layer);
      const at = clamp(to, 0, end - MIN);
      return patchOverlay(edit, layer.id, { at, end: layer.start + (end - at) * layer.speed });
    }
    const moved = clamp((to - layer.at) * layer.speed, -layer.start, layer.end - layer.start - least);
    return patchOverlay(edit, layer.id, { at: Math.max(0, layer.at + moved / layer.speed), start: layer.start + moved });
  }
  return edit;
}

/** Move a text layer or a sound to start at `at`. */
export function moveOverlay(edit: Edit, selection: NonNullable<Selection>, at: number): Edit {
  const to = Math.max(0, at);
  if (selection.kind === "text") return patchText(edit, selection.id, { at: to });
  if (selection.kind === "audio") return patchAudio(edit, selection.id, { at: to });
  if (selection.kind === "overlay") return patchOverlay(edit, selection.id, { at: to });
  return edit;
}

/** Put a main-track clip at another place in the order. */
export function moveClip(edit: Edit, id: string, toIndex: number): Edit {
  const from = edit.clips.findIndex((c) => c.id === id);
  if (from < 0) return edit;
  const clips = [...edit.clips];
  const [clip] = clips.splice(from, 1);
  clips.splice(clamp(toIndex, 0, clips.length), 0, clip!);
  return clips.every((c, i) => c === edit.clips[i]) ? edit : touch(edit, { clips });
}

/**
 * Cut at `t`: the selected text or sound if `t` is inside it, else the main-track clip there.
 * Returns the edit and what to select next (the part after the cut). Nothing changes when the
 * cut would leave a piece shorter than a tenth of a second.
 */
export function splitAt(edit: Edit, t: number, selection: Selection): { edit: Edit; selection: Selection } {
  if (selection?.kind === "text") {
    const layer = edit.texts.find((x) => x.id === selection.id);
    if (layer && t - layer.at >= MIN && layer.at + layer.duration - t >= MIN && edit.texts.length < EDITOR_LIMITS.maxTexts) {
      const right: TextLayer = { ...layer, id: newId(), at: t, duration: layer.at + layer.duration - t };
      const texts = edit.texts.flatMap((x) => (x.id === layer.id ? [{ ...layer, duration: t - layer.at }, right] : [x]));
      return { edit: touch(edit, { texts }), selection: { kind: "text", id: right.id } };
    }
  }
  if (selection?.kind === "audio") {
    const sound = edit.audio.find((x) => x.id === selection.id);
    if (sound && t - sound.at >= MIN && sound.at + audioLength(sound) - t >= MIN && edit.audio.length < EDITOR_LIMITS.maxAudio) {
      const cut = sound.start + (t - sound.at);
      const right: AudioClip = { ...sound, id: newId(), at: t, start: cut, fadeIn: 0 };
      const audio = edit.audio.flatMap((x) => (x.id === sound.id ? [{ ...sound, end: cut, fadeOut: 0 }, right] : [x]));
      return { edit: touch(edit, { audio }), selection: { kind: "audio", id: right.id } };
    }
  }
  if (selection?.kind === "overlay") {
    const layer = edit.overlays.find((x) => x.id === selection.id);
    const length = layer ? overlayLength(layer) : 0;
    if (layer && t - layer.at >= MIN && layer.at + length - t >= MIN && edit.overlays.length < EDITOR_LIMITS.maxOverlays) {
      const cut = layer.start + (t - layer.at) * layer.speed;
      const picture = mediaOf(edit, layer.mediaId)?.kind === "image";
      // A picture's halves both show the picture; a video's carry on from the cut.
      const right: Overlay = picture ? { ...layer, id: newId(), at: t, start: 0, end: layer.end - (cut - layer.start) } : { ...layer, id: newId(), at: t, start: cut };
      const overlays = edit.overlays.flatMap((x) => (x.id === layer.id ? [{ ...layer, end: cut }, right] : [x]));
      return { edit: touch(edit, { overlays }), selection: { kind: "overlay", id: right.id } };
    }
  }
  const placed = layout(edit).find((p) => t - p.from >= MIN && p.to - t >= MIN);
  if (!placed || edit.clips.length >= EDITOR_LIMITS.maxClips) return { edit, selection };
  const { clip } = placed;
  const cut = clip.start + (t - placed.from) * clip.speed;
  // A freeze frame's halves are both its frame: the second starts from it again.
  if (clip.freeze) {
    const first = { ...clip, end: cut, fadeOut: 0 };
    const second: Clip = { ...clip, id: newId(), end: clip.start + (clip.end - cut), fadeIn: 0, transition: undefined };
    const clips = edit.clips.flatMap((c) => (c.id === clip.id ? [first, second] : [c]));
    return { edit: touch(edit, { clips }), selection: { kind: "clip", id: second.id } };
  }
  // No fade appears in the middle: the left part keeps the way in, the right part the way out (and no transition).
  const right: Clip = { ...clip, id: newId(), start: cut, fadeIn: 0, transition: undefined };
  const clips = edit.clips.flatMap((c) => (c.id === clip.id ? [{ ...clip, end: cut, fadeOut: 0 }, right] : [c]));
  return { edit: touch(edit, { clips }), selection: { kind: "clip", id: right.id } };
}

export function removeItem(edit: Edit, selection: Selection): Edit {
  if (!selection) return edit;
  if (selection.kind === "clip") return touch(edit, { clips: edit.clips.filter((c) => c.id !== selection.id) });
  if (selection.kind === "text") return touch(edit, { texts: edit.texts.filter((t) => t.id !== selection.id) });
  if (selection.kind === "overlay") return touch(edit, { overlays: edit.overlays.filter((o) => o.id !== selection.id) });
  return touch(edit, { audio: edit.audio.filter((a) => a.id !== selection.id) });
}

/** A copy right after the original (a clip), or starting where the original ends (text, sound). */
export function duplicateItem(edit: Edit, selection: Selection): { edit: Edit; selection: Selection } {
  if (!selection) return { edit, selection };
  if (selection.kind === "clip") {
    const clip = edit.clips.find((c) => c.id === selection.id);
    if (!clip || edit.clips.length >= EDITOR_LIMITS.maxClips) return { edit, selection };
    const copy = { ...clip, id: newId() };
    return { edit: touch(edit, { clips: edit.clips.flatMap((c) => (c.id === clip.id ? [c, copy] : [c])) }), selection: { kind: "clip", id: copy.id } };
  }
  if (selection.kind === "text") {
    const layer = edit.texts.find((t) => t.id === selection.id);
    if (!layer || edit.texts.length >= EDITOR_LIMITS.maxTexts) return { edit, selection };
    const copy = { ...layer, id: newId(), at: layer.at + layer.duration };
    return { edit: touch(edit, { texts: [...edit.texts, copy] }), selection: { kind: "text", id: copy.id } };
  }
  if (selection.kind === "overlay") {
    const layer = edit.overlays.find((o) => o.id === selection.id);
    if (!layer || edit.overlays.length >= EDITOR_LIMITS.maxOverlays) return { edit, selection };
    const copy = { ...layer, id: newId(), at: layer.at + overlayLength(layer) };
    return { edit: touch(edit, { overlays: [...edit.overlays, copy] }), selection: { kind: "overlay", id: copy.id } };
  }
  const sound = edit.audio.find((a) => a.id === selection.id);
  if (!sound || edit.audio.length >= EDITOR_LIMITS.maxAudio) return { edit, selection };
  const copy = { ...sound, id: newId(), at: sound.at + audioLength(sound) };
  return { edit: touch(edit, { audio: [...edit.audio, copy] }), selection: { kind: "audio", id: copy.id } };
}

export type Range = { start: number; end: number };

/** Ranges in order, overlapping ones joined, empty ones dropped. */
export function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Cut timeline ranges out of the main track and close the gaps. Text moves with the picture it
 * was over; music and voiceovers stay where they are (they'd fall out of step with themselves).
 */
export function rippleDelete(edit: Edit, ranges: Range[]): Edit {
  const cuts = mergeRanges(ranges);
  if (cuts.length === 0) return edit;
  const clips: Clip[] = [];
  for (const placed of layout(edit)) {
    const { clip } = placed;
    // What's left of this clip: the stretches between the cuts that touch it.
    let at = placed.from;
    const kept: Range[] = [];
    for (const cut of cuts) {
      if (cut.end <= placed.from || cut.start >= placed.to) continue;
      if (cut.start > at) kept.push({ start: at, end: cut.start });
      at = Math.max(at, cut.end);
    }
    if (at < placed.to) kept.push({ start: at, end: placed.to });
    const pieces = kept.filter((k) => k.end - k.start >= MIN);
    pieces.forEach((piece, i) => {
      if (clips.length >= EDITOR_LIMITS.maxClips) return;
      const whole = piece.start === placed.from && piece.end === placed.to;
      clips.push({
        ...clip,
        id: whole ? clip.id : newId(),
        start: clip.start + (piece.start - placed.from) * clip.speed,
        end: clip.start + (piece.end - placed.from) * clip.speed,
        fadeIn: i === 0 && piece.start === placed.from ? clip.fadeIn : 0,
        fadeOut: i === pieces.length - 1 && piece.end === placed.to ? clip.fadeOut : 0,
      });
    });
  }
  /** Where a moment of the old timeline lands on the new one. */
  const moved = (t: number) => t - cuts.reduce((gone, cut) => gone + clamp(t - cut.start, 0, cut.end - cut.start), 0);
  const texts = edit.texts.map((layer) => {
    const at = moved(layer.at);
    return { ...layer, at, duration: Math.max(MIN, moved(layer.at + layer.duration) - at) };
  });
  // Layers keep their length (a video would fall out of step with itself) and move to where their start went.
  const overlays = edit.overlays.map((layer) => ({ ...layer, at: moved(layer.at) }));
  return touch(edit, { clips, texts, overlays });
}

/* ------------------------------ Looking at a timeline ------------------------------ */

/** Moments worth snapping to: the ends of every clip, text and sound (not the one being dragged). */
export function snapPoints(edit: Edit, except?: string): number[] {
  const points = [0];
  for (const p of layout(edit)) if (p.clip.id !== except) points.push(p.from, p.to);
  for (const t of edit.texts) if (t.id !== except) points.push(t.at, t.at + t.duration);
  for (const a of edit.audio) {
    if (a.id === except) continue;
    points.push(a.at, a.at + audioLength(a));
    // Its beats, once found: cuts land on them.
    for (const beat of a.beats ?? []) if (beat >= a.start && beat <= a.end) points.push(a.at + (beat - a.start));
  }
  for (const o of edit.overlays) if (o.id !== except) points.push(o.at, o.at + overlayLength(o));
  return points;
}

/** `t`, or the nearest point within `tolerance` of it. */
export function snap(t: number, points: number[], tolerance: number): number {
  let best = t;
  let distance = tolerance;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d <= distance) {
      best = p;
      distance = d;
    }
  }
  return best;
}

/** Rows for items that overlap in time: each item in the first row that's free when it starts. */
export function rowsOf(items: { id: string; at: number; length: number }[]): Map<string, number> {
  const ends: number[] = [];
  const rows = new Map<string, number>();
  for (const item of [...items].sort((a, b) => a.at - b.at)) {
    let row = ends.findIndex((end) => end <= item.at + 1e-6);
    if (row < 0) row = ends.length;
    ends[row] = item.at + item.length;
    rows.set(item.id, row);
  }
  return rows;
}

/** Why an edit can't be exported yet, or null. `toDisk`: written straight to a file, so it can be longer. */
export function exportProblem(edit: Edit, toDisk = false): string | null {
  const total = totalDuration(edit);
  if (total <= 0) return "Add a video or a photo first.";
  const limit = toDisk ? EDITOR_LIMITS.maxDiskDurationSec : EDITOR_LIMITS.maxDurationSec;
  if (total > limit) {
    return toDisk
      ? `An export can be up to ${limit / 60} minutes long. Trim or split this one first.`
      : `An export kept in the browser can be up to ${limit / 60} minutes long. Trim or split this one, or save it straight to disk (Pro).`;
  }
  return null;
}
