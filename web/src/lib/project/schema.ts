import { z } from "zod";

/* Enumerations shared by the UI, the AI prompts and validation. */
export const TONES = ["funny", "bold", "calm", "heartfelt", "educational"] as const;
export const DURATIONS = [15, 30, 45, 60] as const;
export const SHOTS = ["close-up", "medium", "wide", "overhead", "pov", "text-card"] as const;
export const CAPTION_STYLES = ["pop", "clean", "boxed"] as const;
export const TRANSITIONS = ["cut", "fade"] as const;
export const SEVERITIES = ["fix", "improve", "polish"] as const;
export const NOTE_ACTIONS = ["caption", "voiceover", "duration", "hook"] as const;

/* Prebuilt Gemini TTS voices offered in the UI (subset of the 30 available). */
export const VOICES = [
  { id: "Puck", label: "Upbeat" },
  { id: "Kore", label: "Firm" },
  { id: "Aoede", label: "Breezy" },
  { id: "Charon", label: "Informative" },
  { id: "Leda", label: "Youthful" },
  { id: "Sulafat", label: "Warm" },
] as const;
export const VOICE_IDS = VOICES.map((v) => v.id) as [string, ...string[]];

export const LIMITS = {
  idea: 600,
  audience: 120,
  hook: 160,
  angle: 200,
  title: 80,
  caption: 120,
  voiceover: 500,
  visual: 500,
  sceneMin: 1,
  sceneMax: 20,
  maxScenes: 12,
} as const;

export const toneSchema = z.enum(TONES);
export const durationSchema = z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]);
export const shotSchema = z.enum(SHOTS);

export const briefSchema = z.object({
  idea: z.string().trim().min(3, "Tell Bamio a little more about the video.").max(LIMITS.idea),
  templateId: z.string().max(40).optional(),
  durationSec: durationSchema,
  tone: toneSchema,
  audience: z.string().trim().max(LIMITS.audience).optional(),
  voiceover: z.boolean(),
});

export const hookSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1).max(LIMITS.hook),
  angle: z.string().trim().max(LIMITS.angle),
});

export const sceneSchema = z.object({
  id: z.string().min(1),
  durationSec: z.number().min(LIMITS.sceneMin).max(LIMITS.sceneMax),
  voiceover: z.string().max(LIMITS.voiceover),
  caption: z.string().max(LIMITS.caption),
  visual: z.string().max(LIMITS.visual),
  shot: shotSchema,
  /** Asset id of the scene image (generated or uploaded). */
  imageId: z.string().optional(),
  /** Asset id of the generated voice-over clip. */
  audioId: z.string().optional(),
  audioDurationSec: z.number().nonnegative().optional(),
  /** The exact text and voice the clip was generated from, to detect stale audio. */
  audioKey: z.string().optional(),
});

export const noteActionSchema = z.object({
  kind: z.enum(NOTE_ACTIONS),
  sceneId: z.string().optional(),
  value: z.union([z.string(), z.number()]),
});

export const noteSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(SEVERITIES),
  title: z.string().max(120),
  body: z.string().max(400),
  sceneId: z.string().optional(),
  action: noteActionSchema.optional(),
  status: z.enum(["open", "applied", "dismissed"]),
});

export const styleSchema = z.object({
  captionStyle: z.enum(CAPTION_STYLES),
  voice: z.enum(VOICE_IDS),
  transition: z.enum(TRANSITIONS),
});

export const projectSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  title: z.string().max(LIMITS.title),
  createdAt: z.number(),
  updatedAt: z.number(),
  brief: briefSchema,
  hooks: z.array(hookSchema),
  hookId: z.string().optional(),
  scenes: z.array(sceneSchema).max(LIMITS.maxScenes),
  style: styleSchema,
  notes: z.array(noteSchema),
  directorSummary: z.string().optional(),
  lastExport: z.object({ at: z.number(), mime: z.string(), bytes: z.number() }).optional(),
});

export type Tone = z.infer<typeof toneSchema>;
export type Duration = z.infer<typeof durationSchema>;
export type Shot = z.infer<typeof shotSchema>;
export type Brief = z.infer<typeof briefSchema>;
export type Hook = z.infer<typeof hookSchema>;
export type Scene = z.infer<typeof sceneSchema>;
export type NoteAction = z.infer<typeof noteActionSchema>;
export type DirectorNote = z.infer<typeof noteSchema>;
export type ProjectStyle = z.infer<typeof styleSchema>;
export type Project = z.infer<typeof projectSchema>;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type Transition = (typeof TRANSITIONS)[number];
