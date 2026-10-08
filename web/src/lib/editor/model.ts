import { z } from "zod";
import { TOKENS } from "@/lib/brand-tokens";

/*
 * The editor's document: an edit made in the browser (/editor). Everything about it lives on
 * the user's device: this document and the media files in IndexedDB, the preview and the
 * export in the browser. Nothing is uploaded, which is why the editor is free for every
 * account. One main track of clips played one after another (no gaps), text layers and audio
 * clips placed freely in time over it. Times are seconds.
 */

/** Output frames: the pixels of a 1080p export in each shape. */
export const FORMATS = {
  "9:16": { width: 1080, height: 1920, label: "9:16", name: "Vertical" },
  "1:1": { width: 1080, height: 1080, label: "1:1", name: "Square" },
  "4:5": { width: 1080, height: 1350, label: "4:5", name: "Portrait" },
  "16:9": { width: 1920, height: 1080, label: "16:9", name: "Wide" },
} as const;
export const FORMAT_IDS = ["9:16", "1:1", "4:5", "16:9"] as const;
export type FormatId = (typeof FORMAT_IDS)[number];

export const EDITOR_LIMITS = {
  /** The longest edit: the export is built in the browser's memory. */
  maxDurationSec: 10 * 60,
  maxClips: 300,
  maxTexts: 100,
  maxAudio: 40,
  maxText: 240,
  /** The shortest a clip, text or sound can be trimmed to. */
  minItemSec: 0.1,
  /** How long a photo stays when it's added. */
  imageSec: 4,
  textSec: 3,
  minSpeed: 0.25,
  maxSpeed: 4,
  name: 80,
  /** Frames a second of the export. */
  fps: 30,
};

/** Colour looks: a canvas filter each (see lookFilter). */
export const LOOKS = {
  none: { label: "None", filter: "" },
  vivid: { label: "Vivid", filter: "saturate(1.35) contrast(1.08)" },
  punch: { label: "Punch", filter: "contrast(1.25) saturate(1.15)" },
  warm: { label: "Warm", filter: "sepia(0.28) saturate(1.25)" },
  cool: { label: "Cool", filter: "hue-rotate(-14deg) saturate(1.1) brightness(1.03)" },
  fade: { label: "Fade", filter: "contrast(0.86) brightness(1.08) saturate(0.82)" },
  mono: { label: "Mono", filter: "grayscale(1) contrast(1.1)" },
  noir: { label: "Noir", filter: "grayscale(1) contrast(1.4) brightness(0.92)" },
  dream: { label: "Dream", filter: "blur(1.5px) brightness(1.08) saturate(1.25)" },
} as const;
export const LOOK_IDS = Object.keys(LOOKS) as LookId[];
export type LookId = keyof typeof LOOKS;

export const TEXT_STYLES = {
  bold: "Bold",
  box: "Box",
  volt: "Volt",
  plain: "Plain",
} as const;
export const TEXT_STYLE_IDS = Object.keys(TEXT_STYLES) as TextStyle[];
export type TextStyle = keyof typeof TEXT_STYLES;

export const TEXT_ANIMATIONS = {
  none: "None",
  pop: "Pop",
  fade: "Fade",
  rise: "Rise",
  type: "Type on",
} as const;
export const TEXT_ANIMATION_IDS = Object.keys(TEXT_ANIMATIONS) as TextAnimation[];
export type TextAnimation = keyof typeof TEXT_ANIMATIONS;

/** Bamio's two brand colours, for the canvas (which can't read CSS variables). */
export const VOLT = TOKENS.brand["--volt"];
export const INK = TOKENS.brand["--ink"];

/** Text colours, with their names (the style decides where the colour goes: the letters, or the box). */
export const TEXT_COLORS = [
  { value: "#FFFFFF", name: "White" },
  { value: VOLT, name: "Volt" },
  { value: INK, name: "Ink" },
  { value: "#FF4D4D", name: "Red" },
  { value: "#35D6FF", name: "Sky" },
  { value: "#FF7AD9", name: "Pink" },
  { value: "#FFB020", name: "Amber" },
] as const;

export const MOTIONS = { none: "None", in: "Push in", out: "Pull out" } as const;
export type Motion = keyof typeof MOTIONS;

const id = z.string().min(1).max(40);
const seconds = z.number().finite().min(0).max(24 * 3600);
const unit = z.number().finite().min(0).max(1);

/** A file the edit uses. The file itself is kept beside the document (IndexedDB), by this id. */
export const mediaSchema = z.object({
  id,
  kind: z.enum(["video", "image", "audio"]),
  name: z.string().max(260),
  size: z.number().int().min(0),
  /** Its length in seconds (0 for a photo). */
  duration: seconds,
  width: z.number().int().min(0).max(16384),
  height: z.number().int().min(0).max(16384),
  hasAudio: z.boolean(),
});

/** A piece of a video (or a photo) on the main track: source seconds `start` to `end`, played at `speed`. */
export const clipSchema = z.object({
  id,
  mediaId: id,
  start: seconds,
  end: seconds,
  speed: z.number().finite().min(EDITOR_LIMITS.minSpeed).max(EDITOR_LIMITS.maxSpeed),
  volume: unit,
  muted: z.boolean(),
  /** Seconds of the timeline the picture and sound fade over, at each end. */
  fadeIn: z.number().finite().min(0).max(5),
  fadeOut: z.number().finite().min(0).max(5),
  /** "fill" crops to the frame; "fit" shows the whole picture over a blurred copy of itself. */
  fit: z.enum(["fill", "fit"]),
  zoom: z.number().finite().min(1).max(4),
  /** Where the picture sits when there's more of it than the frame shows: -1 (left or top) to 1. */
  x: z.number().finite().min(-1).max(1),
  y: z.number().finite().min(-1).max(1),
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flip: z.boolean(),
  look: z.enum(LOOK_IDS as [LookId, ...LookId[]]),
  /** -1 to 1 each; 0 leaves the picture as it is. */
  brightness: z.number().finite().min(-1).max(1),
  contrast: z.number().finite().min(-1).max(1),
  saturation: z.number().finite().min(-1).max(1),
  motion: z.enum(["none", "in", "out"]),
});

/** Words (or an emoji) over the picture from `at` for `duration` seconds of the timeline. */
export const textSchema = z.object({
  id,
  text: z.string().max(EDITOR_LIMITS.maxText),
  at: seconds,
  duration: seconds,
  /** The centre of the text, as a share of the frame. */
  x: unit,
  y: unit,
  /** The letters' height as a share of the frame's width. */
  size: z.number().finite().min(0.02).max(0.4),
  style: z.enum(TEXT_STYLE_IDS as [TextStyle, ...TextStyle[]]),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  animation: z.enum(TEXT_ANIMATION_IDS as [TextAnimation, ...TextAnimation[]]),
});

/** Music, a voiceover or any sound: source seconds `start` to `end`, heard from `at` on the timeline. */
export const audioSchema = z.object({
  id,
  mediaId: id,
  at: seconds,
  start: seconds,
  end: seconds,
  volume: unit,
  fadeIn: z.number().finite().min(0).max(10),
  fadeOut: z.number().finite().min(0).max(10),
});

export const editSchema = z.object({
  version: z.literal(1),
  id,
  name: z.string().max(EDITOR_LIMITS.name),
  format: z.enum(FORMAT_IDS),
  /** What shows behind a picture that doesn't fill the frame: a blurred copy of it, or a colour. */
  background: z.union([z.literal("blur"), z.string().regex(/^#[0-9A-Fa-f]{6}$/)]),
  /** A bar that fills as the video plays. */
  progress: z.object({ on: z.boolean(), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), top: z.boolean() }),
  media: z.array(mediaSchema).max(200),
  clips: z.array(clipSchema).max(EDITOR_LIMITS.maxClips),
  texts: z.array(textSchema).max(EDITOR_LIMITS.maxTexts),
  audio: z.array(audioSchema).max(EDITOR_LIMITS.maxAudio),
  updatedAt: z.number(),
});

export type Media = z.infer<typeof mediaSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type TextLayer = z.infer<typeof textSchema>;
export type AudioClip = z.infer<typeof audioSchema>;
export type Edit = z.infer<typeof editSchema>;
export type ItemKind = "clip" | "text" | "audio";
export type Selection = { kind: ItemKind; id: string } | null;

let counter = 0;
/** A short id, unique on this device. */
export function newId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 12) : Math.random().toString(36).slice(2, 14);
  return `${random}${(counter++).toString(36)}`;
}

export function newEdit(name = "Untitled edit", now = Date.now()): Edit {
  return {
    version: 1,
    id: newId(),
    name,
    format: "9:16",
    background: "blur",
    progress: { on: false, color: VOLT, top: false },
    media: [],
    clips: [],
    texts: [],
    audio: [],
    updatedAt: now,
  };
}

/** A clip of the whole of a video (or a photo, for imageSec seconds), as it is. */
export function clipOf(media: Media): Clip {
  return {
    id: newId(),
    mediaId: media.id,
    start: 0,
    end: media.kind === "image" ? EDITOR_LIMITS.imageSec : media.duration,
    speed: 1,
    volume: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
    fit: "fill",
    zoom: 1,
    x: 0,
    y: 0,
    rotate: 0,
    flip: false,
    look: "none",
    brightness: 0,
    contrast: 0,
    saturation: 0,
    motion: media.kind === "image" ? "in" : "none",
  };
}

export function textAt(at: number, text = "Your text"): TextLayer {
  return { id: newId(), text, at, duration: EDITOR_LIMITS.textSec, x: 0.5, y: 0.5, size: 0.085, style: "bold", color: "#FFFFFF", animation: "pop" };
}

export function audioOf(media: Media, at: number): AudioClip {
  return { id: newId(), mediaId: media.id, at, start: 0, end: media.duration, volume: 0.8, fadeIn: 0, fadeOut: 0 };
}

/** The canvas filter for a clip's look and its three adjustments ("" when the picture is left alone). */
export function lookFilter(clip: Pick<Clip, "look" | "brightness" | "contrast" | "saturation">): string {
  const parts: string[] = [];
  if (LOOKS[clip.look].filter) parts.push(LOOKS[clip.look].filter);
  // -1..1 maps to 0.5..1.5 for brightness and contrast, 0..2 for saturation.
  if (clip.brightness) parts.push(`brightness(${(1 + clip.brightness * 0.5).toFixed(3)})`);
  if (clip.contrast) parts.push(`contrast(${(1 + clip.contrast * 0.5).toFixed(3)})`);
  if (clip.saturation) parts.push(`saturate(${(1 + clip.saturation).toFixed(3)})`);
  return parts.join(" ");
}

/** "1:05.3" for the editor's clocks. */
export function clock(sec: number, tenths = true): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return tenths ? `${m}:${rest.toFixed(1).padStart(4, "0")}` : `${m}:${String(Math.floor(rest)).padStart(2, "0")}`;
}
