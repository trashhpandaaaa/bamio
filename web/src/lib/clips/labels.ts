import { CLIP_LENGTH_RANGE, type Aspect, type CaptionPosition, type CaptionStyle, type ClipLength, type JobStatus } from "@/lib/clips/schema";

/* Words shown in the UI for schema values. */

export const ASPECT_LABEL: Record<Aspect, string> = { "9:16": "9:16 Vertical", "1:1": "1:1 Square", "16:9": "16:9 Wide" };
export const ASPECT_SHORT: Record<Aspect, string> = { "9:16": "9:16", "1:1": "1:1", "16:9": "16:9" };
export const CAPTION_STYLE_LABEL: Record<CaptionStyle, string> = { pop: "Pop", clean: "Clean", boxed: "Boxed" };
export const CAPTION_STYLE_HELP: Record<CaptionStyle, string> = {
  pop: "Big words, revealed as they’re spoken",
  clean: "One line of plain subtitles",
  boxed: "White text on dark boxes",
};
export const CAPTION_POSITION_LABEL: Record<CaptionPosition, string> = { bottom: "Lower third", middle: "Middle" };
export const CLIP_LENGTH_LABEL: Record<ClipLength, string> = {
  short: `${CLIP_LENGTH_RANGE.short.min} to ${CLIP_LENGTH_RANGE.short.max}s`,
  medium: `${CLIP_LENGTH_RANGE.medium.min} to ${CLIP_LENGTH_RANGE.medium.max}s`,
  long: `${CLIP_LENGTH_RANGE.long.min} to ${CLIP_LENGTH_RANGE.long.max}s`,
};


export const JOB_LABEL: Record<JobStatus, string> = {
  queued: "Waiting to start",
  uploading: "Uploading",
  downloading: "Downloading",
  recording: "Recording live",
  preparing: "Preparing",
  transcribing: "Transcribing",
  syncing: "Syncing captions", // older projects only
  finding: "Finding clips",
  ready: "Ready",
  failed: "Failed",
};

/** 1.2 GB, 340 MB, 12 KB */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "3 min ago", "2 h ago", or a date. */
export function formatAgo(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
