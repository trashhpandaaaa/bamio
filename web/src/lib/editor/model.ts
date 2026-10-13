import { z } from "zod";
import { TOKENS } from "@/lib/brand-tokens";

/*
 * The editor's document: an edit made in the browser (/editor). Everything about it lives on
 * the user's device: this document and the media files in IndexedDB, the preview and the
 * export in the browser. Nothing is uploaded, which is why its basics are free for every
 * account (what needs a plan is in features.ts). One main track of clips played one after another (no gaps), text layers and audio
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
  /** Images and videos laid over the main track. */
  maxOverlays: 40,
  /** The shortest a clip, text or sound can be trimmed to. */
  minItemSec: 0.1,
  /** How long a photo stays when it's added. */
  imageSec: 4,
  textSec: 3,
  minSpeed: 0.25,
  maxSpeed: 4,
  name: 80,
  /** Frames a second of the export, unless 60 is asked for (and of a step with the arrow keys). */
  fps: 30 as const,
  /** The longest export written straight to a file on disk (Pro, Chrome and Edge): it isn't held in memory. */
  maxDiskDurationSec: 60 * 60,
  /** The longest part of a video that can be reversed: it's re-encoded backwards in the browser. */
  maxReverseSec: 60,
  /** How long a freeze frame lasts when it's put in. */
  freezeSec: 2,
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

/**
 * Typefaces for text and captions. The faces themselves are loaded by the page
 * (components/editor/fonts.ts, from Google Fonts at build time, served by Bamio); the drawing
 * code is given their CSS names. `bricolage` is Bamio's own.
 */
export const TEXT_FONTS = {
  bricolage: "Bricolage",
  montserrat: "Montserrat",
  anton: "Anton",
  bebas: "Bebas Neue",
  marker: "Permanent Marker",
  pacifico: "Pacifico",
  mono: "Space Mono",
} as const;
export type FontId = keyof typeof TEXT_FONTS;
export const FONT_IDS = Object.keys(TEXT_FONTS) as FontId[];

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

/** Transitions into a clip from the one before it. */
export const TRANSITIONS = { fade: "Crossfade", slide: "Slide", zoom: "Zoom", whip: "Whip", flash: "Flash" } as const;
export type TransitionKind = keyof typeof TRANSITIONS;
export const TRANSITION_IDS = Object.keys(TRANSITIONS) as TransitionKind[];

/** Caption styles: Pop shows a few words and lights each as it's said (Bamio's own), Karaoke shows the line and lights the word, Clean and Boxed show the line. */
export const CAPTION_STYLES = { pop: "Pop", karaoke: "Karaoke", clean: "Clean", boxed: "Boxed" } as const;
export type CaptionStyleId = keyof typeof CAPTION_STYLES;
export const CAPTION_STYLE_IDS = Object.keys(CAPTION_STYLES) as CaptionStyleId[];

/** How small and how large text can be made by hand (the Size slider, a corner of its frame in the preview), as a share of the frame's width. */
export const TEXT_SIZE = { min: 0.03, max: 0.3 } as const;

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

/**
 * Where TikTok, Reels and Shorts put their own buttons, names and captions over a 9:16 video,
 * as shares of the frame: text is best kept out of these edges. Roughly: each app differs and
 * changes, and published guides disagree, so this takes the larger of their figures.
 */
export const SAFE_ZONE = { top: 0.13, bottom: 0.2, left: 0.055, right: 0.17 } as const;

export const MOTIONS = { none: "None", in: "Push in", out: "Pull out" } as const;
export type Motion = keyof typeof MOTIONS;

const id = z.string().min(1).max(40);
const seconds = z.number().finite().min(0).max(24 * 3600);
const unit = z.number().finite().min(0).max(1);
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/);

/** A rectangle as shares of the frame (or of a picture): its left, top, width and height. */
export const rectSchema = z.object({ x: unit, y: unit, w: z.number().finite().min(0.02).max(1), h: z.number().finite().min(0.02).max(1) });
export type Rect = z.infer<typeof rectSchema>;
/** All of it. */
export const WHOLE: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Green screen: pixels close to `color` turn see-through. `similarity`: how close counts; `smooth`: how soft the edge is. */
export const keySchema = z.object({ color: hex, similarity: unit, smooth: unit });
export type ChromaKey = z.infer<typeof keySchema>;
export const GREEN_KEY: ChromaKey = { color: "#00D639", similarity: 0.38, smooth: 0.12 };

/** Into a clip from the one before it, over the clip's first `sec` seconds (see transitionAt in timeline.ts). */
export const transitionSchema = z.object({ kind: z.enum(TRANSITION_IDS as [TransitionKind, ...TransitionKind[]]), sec: z.number().finite().min(0.1).max(2) });
export type Transition = z.infer<typeof transitionSchema>;

/** Where the picture's middle should be over time (auto-reframe): the clip's source seconds, and the same -1 to 1 as a clip's `x` and `y`. */
export const trackSchema = z.array(z.object({ t: seconds, x: z.number().finite().min(-1).max(1), y: z.number().finite().min(-1).max(1) })).max(20_000);
export type TrackPoint = z.infer<typeof trackSchema>[number];

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
  /** A still: the frame at `start`, for (end - start) / speed seconds, silent. */
  freeze: z.boolean().optional(),
  /** How this clip comes in from the one before it. */
  transition: transitionSchema.optional(),
  /** Where on the frame the picture goes (a layout); left out: the whole frame. */
  box: rectSchema.optional(),
  /** Green screen. */
  key: keySchema.optional(),
  /** Auto-reframe: where its middle goes over time, instead of `x` and `y`. */
  track: trackSchema.optional(),
  /**
   * A second view of the same picture (a facecam): the part `crop` of it, filling `box` on the
   * frame. Part of the clip, so it stays in step through cuts, speed changes and silence removal.
   */
  cam: z.object({ crop: rectSchema, box: rectSchema, radius: z.number().finite().min(0).max(0.5) }).optional(),
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
  /** Left out: Bamio's own typeface. */
  font: z.enum(FONT_IDS as [FontId, ...FontId[]]).optional(),
  /** How the lines line up with each other. Left out: centred. */
  align: z.enum(TEXT_ALIGNS).optional(),
  /** An outline around the letters, as a share of their size (0: none). Left out: the style's own. */
  outline: z.number().finite().min(0).max(0.3).optional(),
  outlineColor: hex.optional(),
  /** A soft shadow under the letters. Left out: the style's own. */
  shadow: z.boolean().optional(),
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
  /** Quieter while someone talks, back up in the pauses (duck.ts). Left out: it plays as it is. */
  duck: z.boolean().optional(),
  /** Its beats, in its own seconds, once found (beats.ts): cuts can be put on them. */
  beats: z.array(seconds).max(10_000).optional(),
});

/**
 * A layer over the main track: a picture (a logo) or a video (a facecam, the other half of a
 * split screen). It shows the part `crop` of its picture, filling `box` on the frame, from
 * `at` on the timeline for (end - start) / speed seconds (a photo: start 0, end its length).
 */
export const overlaySchema = z.object({
  id,
  mediaId: id,
  at: seconds,
  start: seconds,
  end: seconds,
  speed: z.number().finite().min(EDITOR_LIMITS.minSpeed).max(EDITOR_LIMITS.maxSpeed),
  box: rectSchema,
  crop: rectSchema,
  /** Rounded corners, as a share of the box's shorter side: 0.5 is a circle (in a square box). */
  radius: z.number().finite().min(0).max(0.5),
  opacity: unit,
  border: z.boolean(),
  volume: unit,
  muted: z.boolean(),
  key: keySchema.optional(),
});

/** One word of a caption, in its file's own seconds. */
export const captionWordSchema = z.object({ text: z.string().min(1).max(80), start: seconds, end: seconds });
export type CaptionWord = z.infer<typeof captionWordSchema>;

/**
 * Captions: words for each file that has them (keyed by the file's id, in its own seconds, so
 * they stay with what's said however the clips are cut, moved or sped up), and how they look.
 */
export const captionsSchema = z.object({
  on: z.boolean(),
  style: z.enum(CAPTION_STYLE_IDS as [CaptionStyleId, ...CaptionStyleId[]]),
  /** The middle of the caption, as a share of the frame's height. */
  y: unit,
  /** Bigger or smaller than the style's own size. */
  size: z.number().finite().min(0.5).max(2),
  font: z.enum(FONT_IDS as [FontId, ...FontId[]]),
  color: hex,
  /** The word being said. */
  highlight: hex,
  words: z.record(z.string().min(1).max(40), z.array(captionWordSchema).max(20_000)),
  /** The language the words are in, when it's known (a BCP 47 code). */
  language: z.string().max(40).optional(),
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
  /** Images and videos over the main track, the last on top. */
  overlays: z.array(overlaySchema).max(EDITOR_LIMITS.maxOverlays).default([]),
  captions: captionsSchema.optional(),
  /** Bring the export to the loudness the apps play at (loudness.ts). */
  level: z.boolean().optional(),
  updatedAt: z.number(),
});

export type Media = z.infer<typeof mediaSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type TextLayer = z.infer<typeof textSchema>;
export type AudioClip = z.infer<typeof audioSchema>;
export type Overlay = z.infer<typeof overlaySchema>;
export type Captions = z.infer<typeof captionsSchema>;
export type Edit = z.infer<typeof editSchema>;
export type ItemKind = "clip" | "text" | "audio" | "overlay";
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
    overlays: [],
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

/**
 * A layer of a picture or video, at `at`: a third of the frame's width in its top right corner,
 * all of the picture showing (`frame`: the frame's size, for the picture's shape on it).
 */
export function overlayOf(media: Media, at: number, frame: { width: number; height: number }): Overlay {
  const aspect = media.width > 0 && media.height > 0 ? media.width / media.height : 16 / 9;
  const w = 0.34;
  const h = Math.min(0.9, (w * frame.width) / aspect / frame.height);
  return {
    id: newId(),
    mediaId: media.id,
    at,
    start: 0,
    end: media.kind === "image" ? EDITOR_LIMITS.imageSec : media.duration,
    speed: 1,
    box: { x: 1 - w - 0.05, y: 0.05, w, h },
    crop: WHOLE,
    radius: 0.06,
    opacity: 1,
    border: false,
    volume: 1,
    // A second sound over the main track is rarely wanted: on when asked for.
    muted: true,
  };
}

/** Captions as they start, before any words: Bamio's own look, in the lower third. */
export function captionsOf(words: Captions["words"] = {}, language?: string): Captions {
  return { on: true, style: "pop", y: 0.72, size: 1, font: "bricolage", color: "#FFFFFF", highlight: VOLT, words, ...(language ? { language } : {}) };
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
