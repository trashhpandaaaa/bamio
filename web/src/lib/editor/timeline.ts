import { audioOf, clipOf, EDITOR_LIMITS, newId, textAt, type AudioClip, type Clip, type Edit, type Media, type Selection, type TextLayer } from "./model";

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
  return { ...p, local, source: p.clip.start + local * p.clip.speed };
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
  const still = media?.kind === "image";
  const longest = still ? 60 : (media?.duration ?? clip.end);
  const least = MIN * clip.speed;
  if (edge === "end") {
    const end = clamp(clip.start + (to - placed.from) * clip.speed, clip.start + least, longest);
    return patchClip(edit, id, { end });
  }
  const moved = (to - placed.from) * clip.speed;
  // A photo has no "earlier": pulling its left edge only makes it shorter or longer.
  if (still) return patchClip(edit, id, { end: clamp(clip.end - moved, least, longest) });
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
  return edit;
}

/** Move a text layer or a sound to start at `at`. */
export function moveOverlay(edit: Edit, selection: NonNullable<Selection>, at: number): Edit {
  const to = Math.max(0, at);
  if (selection.kind === "text") return patchText(edit, selection.id, { at: to });
  if (selection.kind === "audio") return patchAudio(edit, selection.id, { at: to });
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
  const placed = layout(edit).find((p) => t - p.from >= MIN && p.to - t >= MIN);
  if (!placed || edit.clips.length >= EDITOR_LIMITS.maxClips) return { edit, selection };
  const { clip } = placed;
  const cut = clip.start + (t - placed.from) * clip.speed;
  // No fade appears in the middle: the left part keeps the way in, the right part the way out.
  const right: Clip = { ...clip, id: newId(), start: cut, fadeIn: 0 };
  const clips = edit.clips.flatMap((c) => (c.id === clip.id ? [{ ...clip, end: cut, fadeOut: 0 }, right] : [c]));
  return { edit: touch(edit, { clips }), selection: { kind: "clip", id: right.id } };
}

export function removeItem(edit: Edit, selection: Selection): Edit {
  if (!selection) return edit;
  if (selection.kind === "clip") return touch(edit, { clips: edit.clips.filter((c) => c.id !== selection.id) });
  if (selection.kind === "text") return touch(edit, { texts: edit.texts.filter((t) => t.id !== selection.id) });
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
  return touch(edit, { clips, texts });
}

/* ------------------------------ Looking at a timeline ------------------------------ */

/** Moments worth snapping to: the ends of every clip, text and sound (not the one being dragged). */
export function snapPoints(edit: Edit, except?: string): number[] {
  const points = [0];
  for (const p of layout(edit)) if (p.clip.id !== except) points.push(p.from, p.to);
  for (const t of edit.texts) if (t.id !== except) points.push(t.at, t.at + t.duration);
  for (const a of edit.audio) if (a.id !== except) points.push(a.at, a.at + audioLength(a));
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

/** Why an edit can't be exported yet, or null. */
export function exportProblem(edit: Edit): string | null {
  const total = totalDuration(edit);
  if (total <= 0) return "Add a video or a photo first.";
  if (total > EDITOR_LIMITS.maxDurationSec) return `An export can be up to ${EDITOR_LIMITS.maxDurationSec / 60} minutes long. Trim or split this one first.`;
  return null;
}
