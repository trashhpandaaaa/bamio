import { z } from "zod";
import { durationSchema, toneSchema, VOICE_IDS } from "@/lib/project/schema";

/*
 * Per-user starting values for new videos, stored on the Clerk user
 * (unsafeMetadata.bamioDefaults) so they follow the user across devices.
 */
export const videoDefaultsSchema = z.object({
  durationSec: durationSchema,
  tone: toneSchema,
  voiceover: z.boolean(),
  voice: z.enum(VOICE_IDS),
});

export type VideoDefaults = z.infer<typeof videoDefaultsSchema>;

export const FALLBACK_DEFAULTS: VideoDefaults = { durationSec: 30, tone: "bold", voiceover: true, voice: "Puck" };

/** Read saved defaults from user metadata, falling back field by field when missing or invalid. */
export function readVideoDefaults(unsafeMetadata: unknown): VideoDefaults {
  const raw = (unsafeMetadata as { bamioDefaults?: unknown } | null | undefined)?.bamioDefaults;
  if (!raw || typeof raw !== "object") return FALLBACK_DEFAULTS;
  const record = raw as Record<string, unknown>;
  const pick = <K extends keyof VideoDefaults>(key: K): VideoDefaults[K] => {
    const parsed = videoDefaultsSchema.shape[key].safeParse(record[key]);
    return parsed.success ? (parsed.data as VideoDefaults[K]) : FALLBACK_DEFAULTS[key];
  };
  return { durationSec: pick("durationSec"), tone: pick("tone"), voiceover: pick("voiceover"), voice: pick("voice") };
}
