import { z } from "zod";
import { aspectSchema, CAPTION_STYLES, clipLengthSchema, languageSchema } from "@/lib/clips/schema";

/*
 * Per-user starting values for new imports, stored on the Clerk user
 * (unsafeMetadata.bamioClipDefaults) so they follow the user across devices.
 */
export const clipDefaultsSchema = z.object({
  language: languageSchema,
  findClips: z.boolean(),
  clipLength: clipLengthSchema,
  aspect: aspectSchema,
  captions: z.boolean(),
  captionStyle: z.enum(CAPTION_STYLES),
});

export type ClipDefaults = z.infer<typeof clipDefaultsSchema>;

export const FALLBACK_DEFAULTS: ClipDefaults = { language: "en", findClips: true, clipLength: "medium", aspect: "9:16", captions: true, captionStyle: "pop" };

/** Read saved defaults from user metadata, falling back field by field when missing or invalid. */
export function readClipDefaults(unsafeMetadata: unknown): ClipDefaults {
  const raw = (unsafeMetadata as { bamioClipDefaults?: unknown } | null | undefined)?.bamioClipDefaults;
  if (!raw || typeof raw !== "object") return FALLBACK_DEFAULTS;
  const record = raw as Record<string, unknown>;
  const pick = <K extends keyof ClipDefaults>(key: K): ClipDefaults[K] => {
    const parsed = clipDefaultsSchema.shape[key].safeParse(record[key]);
    return parsed.success ? (parsed.data as ClipDefaults[K]) : FALLBACK_DEFAULTS[key];
  };
  return {
    language: pick("language"),
    findClips: pick("findClips"),
    clipLength: pick("clipLength"),
    aspect: pick("aspect"),
    captions: pick("captions"),
    captionStyle: pick("captionStyle"),
  };
}
