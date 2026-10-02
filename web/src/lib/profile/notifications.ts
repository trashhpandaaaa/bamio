import { z } from "zod";

/*
 * Which emails the user wants, stored on the Clerk user (unsafeMetadata.bamioNotifications)
 * beside the clip defaults. Emails about the plan and payments always go out.
 */
export const notificationsSchema = z.object({
  /** A video finished importing (or a followed stream ended), or an import failed. */
  videos: z.boolean(),
  /** Most, then all, of this month's AI minutes are used. */
  minutes: z.boolean(),
});

export type Notifications = z.infer<typeof notificationsSchema>;

export const DEFAULT_NOTIFICATIONS: Notifications = { videos: true, minutes: true };

/** Saved settings from user metadata, falling back field by field. */
export function readNotifications(unsafeMetadata: unknown): Notifications {
  const raw = (unsafeMetadata as { bamioNotifications?: unknown } | null | undefined)?.bamioNotifications;
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    videos: typeof record.videos === "boolean" ? record.videos : DEFAULT_NOTIFICATIONS.videos,
    minutes: typeof record.minutes === "boolean" ? record.minutes : DEFAULT_NOTIFICATIONS.minutes,
  };
}
