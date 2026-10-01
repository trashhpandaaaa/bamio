import { LIMITS } from "@/lib/clips/schema";

/*
 * Capturing from a live stream (shared by the import form and the server).
 * A capture is "rewind" seconds before the moment it was requested plus "record" seconds
 * after it. Twitch streams with past broadcasts on can rewind to their start (through the
 * in-progress VOD); other streams can't rewind, but the live playlist's last ~30 s are
 * always included. Following a stream captures as far back as it keeps (a Twitch VOD: its
 * start) and keeps going until it ends, while the project is edited.
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

/* ------------------------------ Following ------------------------------ */

/** Following: transcribe new speech in pieces of up to 10 minutes, once a minute has come in. */
export const FOLLOW_PIECE_SEC = { min: 60, max: 600 };
/** Following: look for AI clips once this much new speech is transcribed (and when it ends). */
export const FOLLOW_FIND_EVERY_SEC = 40 * 60;

/**
 * Which phrases of a piece transcribed from `from` to `to` (seconds in the video) to keep,
 * and where the next piece starts. The end of a piece may cut a word, so unless it's the
 * `last` piece, only phrases clear of its end are kept, up to a pause, and the next piece
 * starts inside that pause. Always moves forward.
 */
export function commitPiece<T extends { start: number; end: number }>(phrases: T[], from: number, to: number, last: boolean): { keep: T[]; until: number } {
  if (last) return { keep: phrases, until: to };
  const clear = to - 3;
  for (let i = phrases.length - 1; i >= 0; i--) {
    const p = phrases[i]!;
    const next = phrases[i + 1];
    if (p.end > clear) continue;
    if (!next) return { keep: phrases.slice(0, i + 1), until: Math.max(p.end, clear) };
    if (next.start - p.end >= 0.3) return { keep: phrases.slice(0, i + 1), until: (p.end + next.start) / 2 };
  }
  // No speech at all: the piece was silence.
  if (phrases.length === 0) return { keep: [], until: Math.max(from, clear) };
  // Speech without a pause to cut at (rare: phrases end at pauses): keep all but the last phrase.
  const keep = phrases.slice(0, -1);
  const until = keep.at(-1)?.end ?? from;
  return until > from + 1 ? { keep, until } : { keep: phrases, until: to };
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
