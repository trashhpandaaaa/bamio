import { LIMITS } from "@/lib/clips/schema";

/*
 * Capturing from a live stream (shared by the import form and the server).
 * A capture is "rewind" seconds before the moment it was requested plus "record" seconds
 * after it. Twitch streams with past broadcasts on can rewind to their start (through the
 * in-progress VOD); other streams can't rewind, but the live playlist's last ~30 s are
 * always included.
 */

/** Roughly what a live playlist holds (Twitch, YouTube and Kick all keep about 30 s). */
export const LIVE_WINDOW_SEC = 30;

export const REWIND_CHOICES = [0, 60, 120, 300, 600, 900, 1800, 3600] as const;
export const RECORD_CHOICES = [0, 60, 120, 300, 600, 900, 1800, 3600] as const;

/** "45 s", "5 min", "1 h 20 min" */
export function formatSpan(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** Why a capture can't be made, or null. */
export function liveCaptureProblem(rewindSec: number, recordSec: number, live: { rewindSec: number; canRewind: boolean }): string | null {
  if (!Number.isFinite(rewindSec) || !Number.isFinite(recordSec) || rewindSec < 0 || recordSec < 0) return "Choose how much of the stream to capture.";
  if (rewindSec > 0 && !live.canRewind) return "This stream can only be recorded from now on.";
  if (rewindSec > live.rewindSec + 1) return `The stream can only go back ${formatSpan(live.rewindSec)}.`;
  if (recordSec > LIMITS.maxLiveRecordSec) return `Record up to ${formatSpan(LIMITS.maxLiveRecordSec)} from now.`;
  if (!live.canRewind && recordSec < 10) return "Record for at least 10 seconds.";
  if (rewindSec + recordSec < 10) return "Capture at least 10 seconds.";
  if (rewindSec + recordSec > LIMITS.maxMediaSec) return `Capture up to ${formatSpan(LIMITS.maxMediaSec)} at a time.`;
  return null;
}

/**
 * The part of a Twitch in-progress VOD to download: from `rewindSec` before the request
 * until recording stopped (at most `recordSec` after the request).
 */
export function vodRange(live: { rewindSec: number; recordSec: number; requestedAt: number; vodDurationSec: number }, stoppedAt: number) {
  const elapsed = Math.max(0, Math.min(live.recordSec, (stoppedAt - live.requestedAt) / 1000));
  const start = Math.max(0, live.vodDurationSec - live.rewindSec);
  const end = live.vodDurationSec + elapsed;
  return { start: Math.round(start * 10) / 10, end: Math.round(Math.max(end, start + 1) * 10) / 10 };
}
