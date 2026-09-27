import { z } from "zod";
import {
  LIMITS,
  NOTE_ACTIONS,
  SEVERITIES,
  SHOTS,
  VOICE_IDS,
  briefSchema,
  shotSchema,
  toneSchema,
} from "@/lib/project/schema";

/* ------------------------------------------------------------------ */
/* Helpers: model output is untrusted. Clamp and trim instead of fail. */
/* ------------------------------------------------------------------ */

const clip = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/\s+/g, " ").replace(/[—–]/g, "-").trim())
    .transform((s) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s));

const clampNumber = (min: number, max: number) =>
  z.coerce.number().transform((n) => (Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min));

const lenientShot = z
  .string()
  .transform((s) => s.toLowerCase().trim())
  .transform((s) => ((SHOTS as readonly string[]).includes(s) ? (s as (typeof SHOTS)[number]) : "medium"));

/* ------------------------------------------------------------------ */
/* Requests (browser -> /api/ai/*)                                     */
/* ------------------------------------------------------------------ */

export const hooksRequestSchema = z.object({ brief: briefSchema });

export const scriptRequestSchema = z.object({
  brief: briefSchema,
  hook: z.string().trim().min(1).max(LIMITS.hook),
});

export const imageRequestSchema = z.object({
  visual: z.string().trim().min(3).max(LIMITS.visual),
  shot: shotSchema,
  tone: toneSchema,
});

export const voiceRequestSchema = z.object({
  text: z.string().trim().min(1).max(LIMITS.voiceover),
  voice: z.enum(VOICE_IDS),
  tone: toneSchema,
});

export const directorRequestSchema = z.object({
  brief: briefSchema,
  hook: z.string().max(LIMITS.hook),
  scenes: z
    .array(
      z.object({
        durationSec: z.number(),
        voiceover: z.string().max(LIMITS.voiceover),
        caption: z.string().max(LIMITS.caption),
        visual: z.string().max(LIMITS.visual),
        shot: shotSchema,
        hasImage: z.boolean(),
      }),
    )
    .min(1)
    .max(LIMITS.maxScenes),
});

export type HooksRequest = z.infer<typeof hooksRequestSchema>;
export type ScriptRequest = z.infer<typeof scriptRequestSchema>;
export type ImageRequest = z.infer<typeof imageRequestSchema>;
export type VoiceRequest = z.infer<typeof voiceRequestSchema>;
export type DirectorRequest = z.infer<typeof directorRequestSchema>;

/* ------------------------------------------------------------------ */
/* Model outputs (Gemini -> server), validated leniently               */
/* ------------------------------------------------------------------ */

export const hooksOutputSchema = z.object({
  hooks: z
    .array(z.object({ text: clip(LIMITS.hook), angle: clip(LIMITS.angle).catch("") }))
    .min(1)
    .transform((hooks) => hooks.filter((h) => h.text.length > 0).slice(0, 3)),
});

export const scriptOutputSchema = z.object({
  title: clip(LIMITS.title).catch("Untitled video"),
  scenes: z
    .array(
      z.object({
        durationSec: clampNumber(LIMITS.sceneMin, LIMITS.sceneMax),
        voiceover: clip(LIMITS.voiceover).catch(""),
        caption: clip(LIMITS.caption).catch(""),
        visual: clip(LIMITS.visual).catch(""),
        shot: lenientShot.catch("medium"),
      }),
    )
    .min(1)
    .transform((scenes) => scenes.slice(0, LIMITS.maxScenes)),
});

export const directorOutputSchema = z.object({
  summary: clip(240).catch(""),
  notes: z
    .array(
      z.object({
        severity: z.enum(SEVERITIES).catch("improve"),
        title: clip(120),
        body: clip(400).catch(""),
        /** 1-based scene number, or 0 when the note is about the whole video. */
        scene: z.coerce.number().int().catch(0),
        action: z
          .object({
            kind: z.enum(["none", ...NOTE_ACTIONS]),
            value: z.union([z.string(), z.number()]),
          })
          .nullable()
          .catch(null)
          .transform((a) => normalizeAction(a)),
      }),
    )
    .transform((notes) => notes.slice(0, 8)),
});

type RawAction = { kind: "none" | (typeof NOTE_ACTIONS)[number]; value: string | number } | null;
type Action = { kind: (typeof NOTE_ACTIONS)[number]; value: string | number } | null;

/** Drop empty or "none" actions; make durations numeric and in range; trim text values. */
export function normalizeAction(a: RawAction): Action {
  if (!a || a.kind === "none") return null;
  if (a.kind === "duration") {
    const n = typeof a.value === "number" ? a.value : Number.parseFloat(String(a.value));
    if (!Number.isFinite(n)) return null;
    return { kind: "duration", value: Math.min(LIMITS.sceneMax, Math.max(LIMITS.sceneMin, Math.round(n * 10) / 10)) };
  }
  const text = String(a.value).replace(/\s+/g, " ").replace(/[—–]/g, "-").trim();
  if (!text) return null;
  const max = a.kind === "caption" ? LIMITS.caption : a.kind === "hook" ? LIMITS.hook : LIMITS.voiceover;
  return { kind: a.kind, value: text.slice(0, max) };
}

export type HooksOutput = z.infer<typeof hooksOutputSchema>;
export type ScriptOutput = z.infer<typeof scriptOutputSchema>;
export type DirectorOutput = z.infer<typeof directorOutputSchema>;

/* ------------------------------------------------------------------ */
/* Responses (/api/ai/* -> browser)                                    */
/* ------------------------------------------------------------------ */

export type MediaResponse = { mimeType: string; data: string };
export type VoiceResponse = MediaResponse & { durationSec: number };

export const AI_ERROR_CODES = [
  "no_key",
  "bad_request",
  "rate_limited",
  "not_available",
  "blocked",
  "bad_output",
  "upstream",
  "network",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];
export type AiErrorBody = { error: { code: AiErrorCode; message: string } };

export type AiStatus = {
  configured: boolean;
  mock: boolean;
  models: { text: string; image: string; voice: string };
};
