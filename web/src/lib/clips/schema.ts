import { z } from "zod";
import { usesMultilingualModel } from "./languages";

/* Shared by the browser and the server. Times are seconds within the imported media. */

export const PLATFORMS = ["youtube", "twitch", "kick", "upload", "other"] as const;
export const ASPECTS = ["9:16", "1:1", "16:9"] as const;
export const FRAMINGS = ["crop", "fit"] as const;
export const CAPTION_STYLES = ["pop", "clean", "boxed"] as const;
export const CAPTION_POSITIONS = ["bottom", "middle"] as const;
export const CLIP_LENGTHS = ["short", "medium", "long"] as const;
// "syncing" is no longer used; it stays so projects saved with it still load.
export const JOB_STATUSES = ["queued", "uploading", "downloading", "recording", "preparing", "transcribing", "syncing", "finding", "ready", "failed"] as const;
export const EXPORT_STATUSES = ["queued", "rendering", "done", "failed"] as const;

export const LIMITS = {
  title: 120,
  clipTitle: 100,
  overlayTitle: 80,
  captionText: 400,
  minClipSec: 3,
  maxClipSec: 180,
  maxClips: 60,
  maxMediaSec: 3 * 60 * 60,
  maxUploadBytes: 4 * 1024 ** 3,
  /** Longest live recording from "now" onwards. */
  maxLiveRecordSec: 60 * 60,
  /** Following a stream: how far back it may start, and the most it captures in all. */
  maxFollowBackSec: 6 * 60 * 60,
  maxFollowSec: 12 * 60 * 60,
} as const;

/** Target clip length the AI aims for. */
export const CLIP_LENGTH_RANGE: Record<(typeof CLIP_LENGTHS)[number], { min: number; max: number; label: string }> = {
  short: { min: 15, max: 30, label: "15 to 30 sec" },
  medium: { min: 30, max: 60, label: "30 to 60 sec" },
  long: { min: 60, max: 90, label: "60 to 90 sec" },
};

export const platformSchema = z.enum(PLATFORMS);
export const aspectSchema = z.enum(ASPECTS);
export const clipLengthSchema = z.enum(CLIP_LENGTHS);
/**
 * Spoken language: "auto" (detect it) or a code such as "en" or "hi" (see languages.ts).
 * Every language is transcribed on the device. Older projects may say "other" (= auto).
 */
export const languageSchema = z.string().regex(/^(auto|other|[a-z]{2,3}(-[A-Za-z0-9]{2,8})?)$/, "Choose a language.");

export const rangeSchema = z
  .object({ start: z.number().min(0), end: z.number().positive() })
  .refine((r) => r.end > r.start, "The end must be after the start.");

export const segmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string().max(2000),
  /** When each word is spoken, measured from the audio (one per whitespace-separated word of text). */
  words: z.array(z.object({ start: z.number().min(0), end: z.number().min(0) })).max(500).optional(),
});

export const transcriptSchema = z.object({
  language: z.string().max(40).optional(),
  segments: z.array(segmentSchema),
});

export const clipEditSchema = z.object({
  aspect: aspectSchema,
  framing: z.enum(FRAMINGS),
  /** Horizontal focus for cropping: 0 = left edge, 0.5 = centre, 1 = right edge. */
  focusX: z.number().min(0).max(1),
  captions: z.boolean(),
  captionStyle: z.enum(CAPTION_STYLES),
  captionPosition: z.enum(CAPTION_POSITIONS),
  showTitle: z.boolean(),
  titleText: z.string().max(LIMITS.overlayTitle),
});

export const exportStateSchema = z.object({
  status: z.enum(EXPORT_STATUSES),
  progress: z.number().min(0).max(1),
  error: z.string().optional(),
  bytes: z.number().optional(),
  at: z.number().optional(),
  /** Changes on every render so the download URL is never stale. */
  version: z.number().optional(),
  /** What the render was made from (see exportSignature); differs once the clip is edited again. */
  signature: z.string().max(2000).optional(),
});

export const clipSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(LIMITS.clipTitle),
  start: z.number().min(0),
  end: z.number().min(0),
  origin: z.enum(["ai", "manual"]),
  score: z.number().min(0).max(100).optional(),
  reason: z.string().max(300).optional(),
  edit: clipEditSchema,
  export: exportStateSchema.optional(),
  createdAt: z.number(),
});

export const sourceSchema = z.object({
  kind: z.enum(["url", "upload"]),
  url: z.string().max(2000).optional(),
  platform: platformSchema,
  title: z.string().max(LIMITS.title),
  uploader: z.string().max(200).optional(),
  /** Length of the imported media (after any part-of-video range). */
  durationSec: z.number().min(0),
  width: z.number().min(0),
  height: z.number().min(0),
  hasAudio: z.boolean(),
  /** The part of the original video that was imported, if not all of it. */
  range: z.object({ start: z.number(), end: z.number() }).optional(),
  /** Set when the import was captured from a live stream. */
  live: z
    .object({
      /** Seconds before `requestedAt` to include, and seconds after it to keep recording. */
      rewindSec: z.number().min(0),
      recordSec: z.number().min(0),
      requestedAt: z.number(),
      /** Twitch: the stream's in-progress VOD and its length when the capture was requested. */
      vodUrl: z.string().max(2000).optional(),
      vodDurationSec: z.number().min(0).optional(),
      /** The part of the VOD that was captured, once known (lets a failed download be retried). */
      vodRange: z.object({ start: z.number(), end: z.number() }).optional(),
      /**
       * Set when the stream is followed: captured from as far back as possible and kept
       * growing (as HLS) until it ends or the user stops, then made into one MP4.
       */
      follow: z
        .object({
          /** following: capturing; finishing: last captions and the MP4; ended: a normal video now. */
          status: z.enum(["following", "finishing", "ended"]),
          /** How far before `requestedAt` the capture starts, and whether that is the stream's start. */
          backSec: z.number().min(0),
          fromStart: z.boolean(),
          endedAt: z.number().optional(),
          /** stopped (by the user), ended (the stream did), limit (12 hours), error, restart (the server restarted). */
          endReason: z.enum(["stopped", "ended", "limit", "error", "restart"]).optional(),
        })
        .optional(),
    })
    .optional(),
});

export const jobSchema = z.object({
  status: z.enum(JOB_STATUSES),
  progress: z.number().min(0).max(1),
  message: z.string().max(300),
  error: z.string().max(500).optional(),
  /** Why it failed, when a plan fixes it ("plan_required", "minutes_used", "minutes_short"): the page links to Pricing. */
  errorCode: z.string().max(40).optional(),
  /** Set when the import finished but a later step (captions, AI clips) was skipped. */
  warning: z.string().max(500).optional(),
  /** The steps this run goes through, in order (for the progress stepper). */
  stages: z.array(z.enum(JOB_STATUSES)).max(10).optional(),
  updatedAt: z.number(),
});

export const projectSchema = z.object({
  id: z.string().min(1),
  version: z.literal(1),
  title: z.string().max(LIMITS.title),
  createdAt: z.number(),
  updatedAt: z.number(),
  source: sourceSchema,
  job: jobSchema,
  findClips: z.boolean(),
  clipLength: clipLengthSchema,
  /** The spoken language asked for ("auto" to detect it); missing on older projects (English). */
  language: languageSchema.optional(),
  /** The language the transcript is in: the one asked for, or the one detected. */
  spokenLanguage: z.string().max(20).optional(),
  /** The look new clips start with. */
  defaultEdit: clipEditSchema,
  hasTranscript: z.boolean(),
  /** Bumped on every transcript edit, so exports know when their captions are out of date. */
  transcriptRev: z.number().int().min(0),
  /** "synced" when word times were measured from the audio; otherwise they're estimated per phrase. */
  captionTiming: z.enum(["estimated", "synced"]).optional(),
  /** What made the transcript. Missing on transcripts made before on-device transcription. */
  transcriptEngine: z.enum(["device", "gemini"]).optional(),
  /** The version of the on-device transcriber that made it (TRANSCRIBER_VERSION; missing means 1). */
  transcriber: z.number().int().min(1).optional(),
  /** Followed streams: the transcript covers the video up to here (seconds), and AI clips were looked for up to here. */
  transcribedSec: z.number().min(0).optional(),
  clipsFoundSec: z.number().min(0).optional(),
  /** Bytes expected and received while a file upload is in progress. */
  upload: z
    .object({
      fileName: z.string().max(260),
      size: z.number().int().min(1),
      received: z.number().int().min(0),
      /** Storage's id for the upload in parts, and the parts in so far (S3 needs their ETags to finish it). */
      uploadId: z.string().max(1024).optional(),
      parts: z.array(z.object({ n: z.number().int().min(1).max(10_000), etag: z.string().max(200) })).max(10_000).optional(),
    })
    .optional(),
  clips: z.array(clipSchema).max(LIMITS.maxClips),
});

export type Platform = z.infer<typeof platformSchema>;
export type Aspect = z.infer<typeof aspectSchema>;
export type ClipLength = z.infer<typeof clipLengthSchema>;
export type Language = z.infer<typeof languageSchema>;
export type CaptionStyle = (typeof CAPTION_STYLES)[number];
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];
export type Segment = z.infer<typeof segmentSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type ClipEdit = z.infer<typeof clipEditSchema>;
export type ExportState = z.infer<typeof exportStateSchema>;
export type Clip = z.infer<typeof clipSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Job = z.infer<typeof jobSchema>;
export type Project = z.infer<typeof projectSchema>;
export type JobStatus = Job["status"];

export const DEFAULT_EDIT: ClipEdit = {
  aspect: "9:16",
  framing: "crop",
  focusX: 0.5,
  captions: true,
  captionStyle: "pop",
  captionPosition: "bottom",
  showTitle: false,
  titleText: "",
};

export function isJobActive(status: JobStatus): boolean {
  return status !== "ready" && status !== "failed";
}

/** A followed stream that is still growing (or being finished): its video is HLS, not source.mp4. */
export const isFollowing = (p: Pick<Project, "source">) => {
  const status = p.source.live?.follow?.status;
  return status === "following" || status === "finishing";
};

/**
 * The on-device transcriber's version, saved with each transcript it makes.
 * 2 (2026-09-30): the multilingual model's transcripts tell English from the video's language
 * (English as English, with punctuation; the language in its own script).
 */
export const TRANSCRIBER_VERSION = 2;

/**
 * Why "Transcribe again" would give a better transcript, if it would: "timing" when it wasn't
 * made on the device (older projects, and languages other than English before every language
 * was: caption timing can be off), "languages" when the multilingual model made it before
 * version 2 (English and the video's language were mixed up).
 */
export function retranscribeReason(p: Pick<Project, "hasTranscript" | "transcriptEngine" | "transcriber" | "spokenLanguage" | "source">): "timing" | "languages" | null {
  if (!p.hasTranscript || !p.source.hasAudio || isFollowing(p)) return null;
  if (p.transcriptEngine !== "device") return "timing";
  if ((p.transcriber ?? 1) < 2 && usesMultilingualModel(p.spokenLanguage)) return "languages";
  return null;
}

/* ------------------------------ Requests ------------------------------ */

export const inspectRequestSchema = z.object({ url: z.string().trim().min(1).max(2000) });

export const createFromUrlSchema = z.object({
  url: z.string().trim().min(1).max(2000),
  range: rangeSchema.optional(),
  /**
   * For a live stream: follow it (from as far back as possible, until it ends), or capture
   * a part: how far back to start and how long to keep recording, in seconds.
   */
  live: z
    .object({ follow: z.boolean().optional(), rewindSec: z.number().min(0).max(LIMITS.maxMediaSec), recordSec: z.number().min(0).max(LIMITS.maxLiveRecordSec) })
    .optional(),
  findClips: z.boolean(),
  clipLength: clipLengthSchema,
  language: languageSchema.optional(),
  edit: clipEditSchema.partial().optional(),
});

export const createUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(260),
  size: z.number().int().min(1).max(LIMITS.maxUploadBytes),
  findClips: z.boolean(),
  clipLength: clipLengthSchema,
  language: languageSchema.optional(),
  edit: clipEditSchema.partial().optional(),
});

export const findClipsSchema = z.object({ clipLength: clipLengthSchema });

export const addClipSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  title: z.string().trim().max(LIMITS.clipTitle).optional(),
});

export const updateClipSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.clipTitle).optional(),
  start: z.number().min(0).optional(),
  end: z.number().min(0).optional(),
  edit: clipEditSchema.partial().optional(),
});

export const updateProjectSchema = z.object({
  title: z.string().trim().min(1).max(LIMITS.title).optional(),
  /** Copy this clip's look (frame and captions, not its title text) to every clip and to new clips. */
  applyEditFrom: z.string().min(1).max(64).optional(),
});

export const updateSegmentSchema = z.object({
  index: z.number().int().min(0),
  text: z.string().max(LIMITS.captionText),
});

/* ------------------------------ Responses ----------------------------- */

/** Upload chunks stay under the 10 MB body buffer that Next.js applies to requests passing through proxy.ts. */
export const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;

export type InspectResult = {
  url: string;
  platform: Platform;
  title: string;
  uploader?: string;
  durationSec: number;
  thumbnail?: string;
  /**
   * Present when the link is a live stream. `rewindSec` is how far back it can be captured:
   * a Twitch stream with past broadcasts on can go back to its start; other streams only
   * hold the last few seconds (included automatically).
   */
  live?: {
    rewindSec: number;
    canRewind: boolean;
    startedAt?: number;
    /** Following: how far back the capture would start, and whether that is the stream's start. */
    followBackSec: number;
    followFromStart: boolean;
  };
};

export type SystemStatus = {
  ytdlp: string | null;
  ffmpeg: string | null;
  ai: { configured: boolean; mock: boolean };
  /** Plans and payments (Stripe) are on: importing needs a plan. */
  billing: boolean;
};
