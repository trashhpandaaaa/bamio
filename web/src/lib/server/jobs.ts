import "server-only";
import { mkdir, readFile, rm, statfs } from "node:fs/promises";
import { clipTarget, findHighlights, transcribeChunk, tidySegments } from "@/lib/ai/server/clips-ai";
import { aiConfigured } from "@/lib/ai/server/gemini";
import { buildAss } from "@/lib/clips/ass";
import { captionLines, exportSignature, overlayTitle } from "@/lib/clips/logic";
import { isFollowing, LIMITS, TRANSCRIBER_VERSION, type Clip, type ClipLength, type JobStatus, type Project, type Segment, type Transcript } from "@/lib/clips/schema";
import { isAbortError } from "@/lib/server/bin";
import { assertCanProcess, hasUsage, queuePriority, recordUsage, secondsLeft } from "@/lib/server/billing";
import { assMarkup, ensureFont, fontsNeeded } from "@/lib/server/caption-fonts";
import { emailMode, queueEmail } from "@/lib/server/email";
import { HttpError } from "@/lib/server/http";
import { limiter, type Limiter } from "@/lib/server/limiter";
import { activeJobs, enqueue, requestCancel, requestStop, waitForIdle, type JobKind } from "@/lib/server/queue";
import type { KindSpec, Pool } from "@/lib/server/worker";
import { downloadUrl, extractAudioChunks, extractFrame, prepareSource, probe, renderClip } from "@/lib/server/media";
import { relocateAiClips } from "@/lib/clips/relocate";
import { commitPiece, FOLLOW_FIND_EVERY_SEC, FOLLOW_PIECE_SEC } from "@/lib/clips/live";
import { followLive, recordLive, sleep, type FollowEnd } from "@/lib/server/live";
import { clearLive, liveCaptured, liveDir, liveSnapshot, syncLive } from "@/lib/server/live-media";
import { storage } from "@/lib/server/storage";
import { localTranscriptionOn, transcribeLocal } from "@/lib/server/transcribe";
import { dataRoot, getProject, isPrepared, mediaKeys, mutateProject, readTranscript, scratch, workRoot, writeTranscript } from "@/lib/server/store";
import { newId } from "@/lib/ids";

/*
 * Background work: imports (download or upload, prepare, transcribe, find clips), analysis,
 * exports and followed streams. Starting work queues a job (queue.ts); workers run it
 * (worker.ts: in the web server, or their own processes) with the handlers at the end of this
 * file. Progress is written to the project, which the browser polls. Plans with priority
 * processing go first (billing.ts). The user gets an email when an import or a followed
 * stream is ready, or an import fails (email.ts; they can turn these off).
 */

/** In this process: short frame grabs (web), and transcribing followed streams one piece at a time (workers). */
type Limiters = { frames: Limiter; live: Limiter };
const limits: Limiters = ((globalThis as { __bamioLimits?: Limiters }).__bamioLimits ??= { frames: limiter(3), live: limiter(1) });
limits.live ??= limiter(1);

/** Run a short ffmpeg frame grab without flooding the machine. */
export const withFrameLimit: Limiter = (task) => limits.frames(task);

const errorText = (err: unknown) => (err instanceof HttpError ? err.message : "Something went wrong. Try again.");

/* ------------------------------ Progress ------------------------------ */

/**
 * The steps a run will go through, for the progress stepper. Steps that turn out not to
 * be needed (no sound, AI off) are simply skipped when the run gets there.
 */
export function plannedStages(p: Pick<Project, "source" | "findClips" | "hasTranscript">, opts: { findClips?: boolean } = {}): JobStatus[] {
  const stages: JobStatus[] = [];
  if (!isPrepared(p as Project)) stages.push(p.source.live ? "recording" : p.source.kind === "url" ? "downloading" : "uploading", "preparing");
  if (!p.hasTranscript && (localTranscriptionOn() || aiConfigured())) stages.push("transcribing");
  if ((opts.findClips ?? p.findClips) && aiConfigured()) stages.push("finding");
  return stages;
}

function jobWriter(userId: string, projectId: string) {
  let last = 0;
  // The planned steps stay on the job while it moves through them.
  const set = (status: JobStatus, progress: number, message: string, extra: { warning?: string; error?: string; errorCode?: string } = {}) =>
    mutateProject(userId, projectId, (p) => ({ ...p, job: { status, progress, message, updatedAt: Date.now(), stages: p.job.stages, ...extra } }));
  /** Throttled: at most one write every 750 ms. */
  const progress = (status: JobStatus, value: number, message: string) => {
    const now = Date.now();
    if (now - last < 750) return;
    last = now;
    void set(status, Math.min(1, Math.max(0, value)), message).catch(() => undefined);
  };
  return { set, progress };
}

/* ------------------------------ Starting work ------------------------------ */

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/**
 * Process a project (download or recording, preparing, transcribing, finding clips): queued
 * for a worker; nothing new if it's already queued or running. `retries`: false for live
 * captures, whose moment has passed by the time a retry would run.
 */
export async function startImport(userId: string, projectId: string, opts: { retries?: boolean } = {}) {
  await enqueue({ kind: "import", userId, projectId, priority: await queuePriority(userId), maxAttempts: opts.retries === false ? 1 : 3 });
}

/** Transcribe (if needed) and find clips on a project that is already imported. */
export async function startAnalysis(userId: string, projectId: string, clipLength: ClipLength): Promise<Project> {
  const priority = await queuePriority(userId);
  return mutateProject(
    userId,
    projectId,
    (p) => {
      if (p.job.status !== "ready" || !isPrepared(p)) throw new HttpError(409, "not_ready", "Wait for the video to finish processing.");
      const stages = plannedStages(p, { findClips: true });
      return { ...p, clipLength, findClips: true, job: { status: "queued", progress: 0, message: "Waiting to start", updatedAt: Date.now(), stages } };
    },
    { then: (tx) => enqueue({ kind: "analyze", userId, projectId, priority, maxAttempts: 2 }, tx) },
  );
}

/**
 * Transcribe an imported video again on this device, replacing its transcript. For
 * projects transcribed before on-device transcription (English before 2026-09-28, other
 * languages before 2026-09-29), whose timing was approximate. Clips are kept; their
 * captions follow the new transcript.
 */
export async function startRetranscribe(userId: string, projectId: string): Promise<Project> {
  const priority = await queuePriority(userId);
  return mutateProject(
    userId,
    projectId,
    (p) => {
      if (p.job.status !== "ready" || !isPrepared(p)) throw new HttpError(409, "not_ready", "Wait for the video to finish processing.");
      if (!p.source.hasAudio) throw new HttpError(409, "no_audio", "This video has no sound to transcribe.");
      if (isFollowing(p)) throw new HttpError(409, "following", "The stream is still being followed. Its captions are made as it goes.");
      return { ...p, job: { status: "queued", progress: 0, message: "Waiting to start", updatedAt: Date.now(), stages: ["transcribing"] } };
    },
    { then: (tx) => enqueue({ kind: "retranscribe", userId, projectId, priority, maxAttempts: 2 }, tx) },
  );
}

/** Ask a capture (or a followed stream) to end now, keeping what was recorded. */
export async function stopRecording(projectId: string): Promise<boolean> {
  return (await requestStop(projectId)) > 0;
}

/* ------------------------------ Analysis ------------------------------ */

async function runAnalysis(userId: string, projectId: string, signal: AbortSignal) {
  const job = jobWriter(userId, projectId);
  try {
    const warning = await analyze(userId, projectId, signal, { findClips: true });
    await job.set("ready", 1, "Ready", { warning });
  } catch (err) {
    if (signal.aborted || isAbortError(err)) throw err;
    await job.set("ready", 1, "Ready", { warning: `Finding clips failed: ${errorText(err)}` });
  }
}

async function runRetranscribe(userId: string, projectId: string, signal: AbortSignal) {
  const job = jobWriter(userId, projectId);
  try {
    await job.set("transcribing", 0, "Transcribing on this device");
    const before = await readTranscript(userId, projectId);
    const { language } = await getProject(userId, projectId);
    const source = await storage().readable(mediaKeys(userId, projectId).source);
    const transcript = await transcribeLocal(source, scratch(projectId).transcribe, language, signal, (v, message) => job.progress("transcribing", v, message));
    let moved = 0;
    await mutateProject(userId, projectId, async (cur) => {
      await writeTranscript(userId, projectId, transcript);
      // AI clips were placed with the old transcript's times; put them where their words are.
      const relocated = before ? relocateAiClips(cur.clips, before.segments, transcript.segments, cur.source.durationSec) : { clips: cur.clips, moved: 0 };
      moved = relocated.moved;
      return {
        ...cur,
        clips: relocated.clips,
        hasTranscript: true,
        transcriptEngine: "device",
        transcriber: TRANSCRIBER_VERSION,
        captionTiming: "synced",
        spokenLanguage: transcript.language,
        transcriptRev: cur.transcriptRev + 1,
      };
    });
    const note = moved > 0 ? `Transcribed again. ${moved} AI ${moved === 1 ? "clip was" : "clips were"} moved to where their words are spoken.` : undefined;
    await job.set("ready", 1, "Ready", { warning: note });
  } catch (err) {
    if (signal.aborted || isAbortError(err)) throw err;
    await job.set("ready", 1, "Ready", { warning: `Transcribing again failed: ${errorText(err)}` });
  }
}

async function saveTranscript(userId: string, projectId: string, transcript: Transcript, engine: "device" | "gemini") {
  await mutateProject(userId, projectId, async (cur) => {
    await writeTranscript(userId, projectId, transcript);
    return {
      ...cur,
      hasTranscript: true,
      transcriptEngine: engine,
      transcriber: engine === "device" ? TRANSCRIBER_VERSION : undefined,
      captionTiming: engine === "device" ? "synced" : "estimated",
      spokenLanguage: transcript.language ?? cur.spokenLanguage,
      transcriptRev: cur.transcriptRev + 1,
    };
  });
}

/** Errors are the worker's to handle: it tries again later, or marks the import failed (importFailed). */
async function runImport(userId: string, projectId: string, signal: AbortSignal, stopSignal: AbortSignal) {
  const job = jobWriter(userId, projectId);
  const keys = mediaKeys(userId, projectId);
  const work = scratch(projectId);
  {
    signal.throwIfAborted();
    let project = await getProject(userId, projectId);

    if (!isPrepared(project) || !(await storage().stat(keys.source))) {
      // The work happens in this machine's scratch folder; what's kept goes to storage.
      await mkdir(work.dir, { recursive: true });
      let original: string;
      let uploaded = false;
      if (project.source.live) {
        await job.set("recording", 0, "Starting the recording");
        {
          const recorded = await recordLive(project.source, work.download, {
            signal,
            stopSignal,
            onProgress: (value, message) => job.progress("recording", value, message),
          });
          original = recorded.file;
          if (recorded.vodRange) {
            const vodRange = recorded.vodRange;
            await mutateProject(userId, projectId, (cur) => ({ ...cur, source: { ...cur.source, live: cur.source.live ? { ...cur.source.live, vodRange } : undefined } }));
          }
        }
      } else if (project.source.kind === "url") {
        await job.set("downloading", 0, "Downloading the video");
        original = await downloadUrl(project.source.url ?? "", work.download, {
          range: project.source.range,
          signal,
          onProgress: (value) => value !== null && job.progress("downloading", value, "Downloading the video"),
        });
      } else {
        if (!(await storage().stat(keys.upload))) throw new HttpError(409, "upload_missing", "The uploaded file is gone. Upload it again.");
        original = await storage().readable(keys.upload);
        uploaded = true;
      }

      await job.set("preparing", 0, "Preparing the video");
      const info = await probe(original, signal);
      if (!info.hasVideo) throw new HttpError(422, "no_video", "That file has no video in it.");
      if (info.durationSec < 1) throw new HttpError(422, "too_short", "That video is too short to clip.");
      if (info.durationSec > LIMITS.maxMediaSec + 5) {
        throw new HttpError(422, "too_long", "That video is longer than 3 hours. Import a part of it instead.");
      }
      // AI minutes: checked now the length is known (an upload's wasn't before), counted once it's prepared.
      if (!(await hasUsage(userId, projectId))) {
        await assertCanProcess(userId, { sec: info.durationSec, source: project.source.live ? "capture" : project.source.kind === "url" ? "link" : "upload" });
      }
      await prepareSource(original, work.prepared, info, {
        live: Boolean(project.source.live),
        signal,
        onProgress: (v) => job.progress("preparing", v, "Preparing the video"),
      });
      // Measure the prepared file itself (a remuxed live recording can differ slightly from the capture).
      const prepared = await probe(work.prepared, signal);
      await recordUsage(userId, projectId, prepared.durationSec);
      await extractFrame(work.prepared, work.thumb, Math.min(prepared.durationSec * 0.1, 8), 640, signal)
        .then(() => storage().publish(keys.thumb, work.thumb, "image/jpeg"))
        .catch(() => undefined);
      await storage().publish(keys.source, work.prepared, "video/mp4");
      if (uploaded) await storage().remove(keys.upload);
      await rm(work.dir, { recursive: true, force: true });
      project = await mutateProject(userId, projectId, (cur) => ({
        ...cur,
        upload: undefined,
        source: { ...cur.source, durationSec: prepared.durationSec, width: prepared.width, height: prepared.height, hasAudio: prepared.hasAudio },
      }));
    }

    const warning = await analyze(userId, projectId, signal, { findClips: project.findClips });
    await job.set("ready", 1, "Ready", { warning });
    await emailReady(userId, projectId, warning);
  }
}

async function importFailed(userId: string, projectId: string, jobId: number, err: unknown) {
  if (!(err instanceof HttpError)) console.error("[bamio/jobs] import failed", err);
  // Plan problems (402) keep their code, so the page can offer the plans.
  const errorCode = err instanceof HttpError && err.status === 402 ? err.code : undefined;
  const project = await jobWriter(userId, projectId).set("failed", 0, "Import failed", { error: errorText(err), errorCode });
  await emailFailed(userId, project, `video-failed:${projectId}:${jobId}`);
}

/* ------------------------------ Emails ------------------------------ */

/** Tell the user a video (or a followed stream) is ready, with its best AI clips: once per project. */
async function emailReady(userId: string, projectId: string, warning: string | undefined) {
  if (emailMode() === "off") return;
  try {
    const project = await getProject(userId, projectId);
    const ai = project.clips.filter((c) => c.origin === "ai").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    await queueEmail(userId, `video-ready:${projectId}`, {
      template: "video-ready",
      projectId,
      title: project.title,
      stream: Boolean(project.source.live?.follow),
      durationSec: project.source.durationSec,
      captioned: project.hasTranscript,
      clipCount: ai.length,
      clips: ai.slice(0, 3).map((c) => ({ title: c.title, score: c.score, start: c.start })),
      ...(warning ? { warning } : {}),
    });
  } catch (err) {
    console.warn("[bamio/jobs] couldn’t queue the ready email:", err instanceof Error ? err.message : err);
  }
}

/** Tell the user an import (or a followed stream) failed, with why. */
async function emailFailed(userId: string, project: Project, key: string) {
  if (emailMode() === "off") return;
  await queueEmail(userId, key, { template: "video-failed", projectId: project.id, title: project.title, error: project.job.error ?? "Something went wrong." }).catch((err: unknown) =>
    console.warn("[bamio/jobs] couldn’t queue the failure email:", err instanceof Error ? err.message : err),
  );
}

async function importRetrying(userId: string, projectId: string, err: unknown, delayMs: number) {
  await jobWriter(userId, projectId).set("queued", 0, `Something went wrong (${errorText(err).replace(/\.$/, "")}). Trying again in ${minutes(delayMs)} min.`);
}

/**
 * Transcribe (unless a transcript exists) and optionally find clips. Every language is
 * transcribed on this device with word timing (Gemini only with BAMIO_LOCAL_TRANSCRIBE=0).
 * Returns a warning when a step was skipped; the project stays usable for manual clipping.
 */
async function analyze(userId: string, projectId: string, signal: AbortSignal, opts: { findClips: boolean }): Promise<string | undefined> {
  const job = jobWriter(userId, projectId);
  const project = await getProject(userId, projectId);
  if (!project.source.hasAudio) return "This video has no sound, so there are no captions or AI clips. You can still cut clips by hand.";
  const local = localTranscriptionOn();
  const noAi = "Gemini isn’t connected. Add GEMINI_API_KEY to web/.env and restart.";

  let segments: Segment[];
  const existing = project.hasTranscript ? await readTranscript(userId, projectId) : null;
  if (existing) {
    segments = existing.segments;
  } else if (isFollowing(project)) {
    return "The stream’s captions are still being made. Try again in a minute.";
  } else if (!local && !aiConfigured()) {
    return `Captions and AI clips are off because ${noAi}`;
  } else {
    try {
      let transcript: Transcript;
      if (local) {
        await job.set("transcribing", 0, "Transcribing on this device");
        const source = await storage().readable(mediaKeys(userId, projectId).source);
        transcript = await transcribeLocal(source, scratch(projectId).transcribe, project.language, signal, (v, message) => job.progress("transcribing", v, message));
      } else {
        await job.set("transcribing", 0, "Transcribing with Gemini");
        transcript = await transcribe(userId, projectId, project.source.durationSec, signal, (v) => job.progress("transcribing", v, "Transcribing with Gemini"));
      }
      segments = transcript.segments;
      await saveTranscript(userId, projectId, transcript, local ? "device" : "gemini");
    } catch (err) {
      if (signal.aborted || isAbortError(err)) throw err;
      if (!(err instanceof HttpError)) console.error("[bamio/jobs] transcription failed", err);
      return `Captions and AI clips were skipped: ${errorText(err)}`;
    }
  }
  if (segments.length === 0) return "No speech was found, so there are no captions or AI clips. You can still cut clips by hand.";
  if (!opts.findClips) return undefined;
  if (!aiConfigured()) return `Captions are ready. AI clips are off because ${noAi}`;
  return findClipsStep(userId, projectId, segments, signal);
}

/**
 * Find AI clips in `segments`. `spanSec`: the video they cover, when only part of it (a
 * followed stream's newest part); then the project's status isn't touched either.
 */
async function findClipsStep(userId: string, projectId: string, segments: Segment[], signal: AbortSignal, spanSec?: number): Promise<string | undefined> {
  const job = jobWriter(userId, projectId);
  let project: Project;
  try {
    if (spanSec === undefined) await job.set("finding", 0, "Finding the best moments");
    project = await getProject(userId, projectId);
    const room = LIMITS.maxClips - project.clips.length;
    if (room <= 0) return `This project already has ${LIMITS.maxClips} clips. Delete some to find more.`;
    const found = await findHighlights({
      segments,
      durationSec: project.source.durationSec,
      clipLength: project.clipLength,
      title: project.title,
      language: project.spokenLanguage,
      spanSec,
      avoid: project.clips.map((c) => ({ start: c.start, end: c.end })),
      signal,
    });
    let added = 0;
    await mutateProject(userId, projectId, (cur) => {
      const now = Date.now();
      const fresh = found
        .filter((c) => !cur.clips.some((k) => Math.min(k.end, c.end) - Math.max(k.start, c.start) > 0.5 * Math.min(k.end - k.start, c.end - c.start)))
        .slice(0, Math.min(room, clipTarget(spanSec ?? cur.source.durationSec, cur.clipLength)))
        .map<Clip>((c, i) => ({
          id: newId(),
          title: c.title,
          start: c.start,
          end: c.end,
          origin: "ai",
          score: c.score,
          reason: c.reason,
          edit: { ...cur.defaultEdit },
          createdAt: now + i,
        }));
      added = fresh.length;
      return { ...cur, clips: [...cur.clips, ...fresh] };
    });
    return added === 0 ? "Bamio didn’t find more standalone moments. Mark clips by hand on the timeline." : undefined;
  } catch (err) {
    if (signal.aborted || isAbortError(err)) throw err;
    if (!(err instanceof HttpError)) console.error("[bamio/jobs] finding clips failed", err);
    return `AI clips were skipped: ${errorText(err)}`;
  }
}

/** Gemini transcription chunk (only with BAMIO_LOCAL_TRANSCRIBE=0). Long chunks drift and drop text; see DESIGN_STATUS.md. */
const CHUNK_SEC = 300;

async function transcribe(userId: string, projectId: string, durationSec: number, signal: AbortSignal, onProgress: (p: number) => void) {
  const dir = scratch(projectId).audio;
  try {
    const chunks = await extractAudioChunks(await storage().readable(mediaKeys(userId, projectId).source), dir, CHUNK_SEC, signal);
    let done = 0;
    let language: string | undefined;
    const pieces: Segment[][] = new Array(chunks.length);
    const next = limiter(3);
    await Promise.all(
      chunks.map((chunk, i) =>
        next(async () => {
          signal.throwIfAborted();
          const length = Math.max(0.1, Math.min(CHUNK_SEC, durationSec - chunk.offset));
          const result = await transcribeChunk(await readFile(chunk.file), length, signal);
          language ??= result.language;
          pieces[i] = result.segments.map((s) => ({ ...s, start: s.start + chunk.offset, end: s.end + chunk.offset }));
          onProgress(++done / chunks.length);
        }),
      ),
    );
    return { language, segments: tidySegments(pieces.flat(), durationSec) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/* --------------------------- Followed streams --------------------------- */

/**
 * Follow a live stream: capture it as growing HLS (from as far back as it keeps), make the
 * project editable as soon as there's video, and keep its length, captions and AI clips
 * up to date while it grows. When the stream ends (or the user stops, or 12 hours are
 * captured), the rest is transcribed and everything becomes one MP4 like any other video.
 */
export async function startFollow(userId: string, projectId: string) {
  await enqueue({ kind: "follow", userId, projectId, priority: await queuePriority(userId), maxAttempts: 3 });
}

const finishTried = new Map<string, number>();

/**
 * A followed stream left "finishing" (its follow job failed for good, or it predates the job
 * queue) gets finished when its project is next opened (at most once a minute).
 */
export async function resumeFollow(userId: string, project: Project) {
  if (project.source.live?.follow?.status !== "finishing") return;
  if (Date.now() - (finishTried.get(project.id) ?? 0) < 60_000) return;
  finishTried.set(project.id, Date.now());
  const active = (await activeJobs([project.id])).get(project.id);
  if (active?.kinds.has("follow") || active?.kinds.has("finish-follow")) return;
  await enqueue({ kind: "finish-follow", userId, projectId: project.id, priority: await queuePriority(userId), maxAttempts: 3 });
}

/** Seconds kept clear of the live edge (its last segment may still be arriving). */
const LIVE_EDGE_SEC = 8;

/**
 * Run `task` on the project's video, as something ffmpeg can open: source.mp4 (a file, or a
 * signed link to it), or while a stream is followed a closed snapshot of its playlist.
 */
export async function withSourceFile<T>(userId: string, project: Project, task: (file: string) => Promise<T>): Promise<T> {
  if (!isFollowing(project)) return task(await storage().readable(mediaKeys(userId, project.id).source));
  const snap = await liveSnapshot(userId, project.id);
  try {
    return await task(snap.file);
  } finally {
    await snap.done();
  }
}

/**
 * `resumed`: a worker that was following this stream stopped (crash, deploy). What it had
 * captured is finished into a video; reconnecting to the stream isn't attempted.
 */
async function followProject(userId: string, projectId: string, signal: AbortSignal, stopSignal: AbortSignal, resumed: boolean) {
  if (resumed && isPrepared(await getProject(userId, projectId))) {
    await mutateProject(userId, projectId, (cur) => {
      const live = cur.source.live;
      if (!live?.follow) return cur;
      return { ...cur, source: { ...cur.source, live: { ...live, follow: { ...live.follow, status: "finishing", endReason: "restart", endedAt: Date.now() } } } };
    });
    await finishFollow(userId, projectId, signal);
    return;
  }
  const job = jobWriter(userId, projectId);
  const dir = liveDir(userId, projectId);
  const work = scratch(projectId);
  const keys = mediaKeys(userId, projectId);
  // With object storage, what's captured is copied up as it grows (players and other machines read it there).
  const sync = () => syncLive(userId, projectId).catch((err: unknown) => console.error("[bamio/live] copying the stream to storage failed", err));
  // Ends the capture: asked by the user (stopSignal), or when the plan's minutes run out (followWork).
  const stop = new AbortController();
  stopSignal.addEventListener("abort", () => stop.abort(), { once: true });
  let ended: FollowEnd | null = null;
  let failure: unknown = null;
  let capture: Promise<void> | null = null;
  try {
    const project = await getProject(userId, projectId);
    const follow = project.source.live?.follow;
    if (!follow) return;
    await clearLive(userId, projectId);
    await mkdir(work.dir, { recursive: true });
    await job.set("recording", 0, "Connecting to the stream");
    capture = followLive(project.source, dir, { backSec: follow.backSec, signal, stopSignal: stop.signal }).then(
      (reason) => {
        ended = reason;
      },
      (err: unknown) => {
        ended = "error";
        failure = err;
      },
    );

    // Editable once a few segments are in.
    const connectBy = Date.now() + 5 * 60_000;
    while (ended === null && (await liveCaptured(userId, projectId)) < 12 && Date.now() < connectBy) await sleep(1000, signal);
    await sync();
    if ((await liveCaptured(userId, projectId)) <= 0) {
      stop.abort();
      await capture;
      if (isAbortError(failure)) throw failure;
      throw failure instanceof HttpError ? failure : new HttpError(422, "record_failed", "Bamio couldn’t record that stream. It may have ended or be restricted.");
    }
    await withSourceFile(userId, project, async (file) => {
      const info = await probe(file, signal);
      await extractFrame(file, work.thumb, Math.min(info.durationSec * 0.1, 8), 640, signal)
        .then(() => storage().publish(keys.thumb, work.thumb, "image/jpeg"))
        .catch(() => undefined);
      await mutateProject(userId, projectId, (cur) => ({
        ...cur,
        source: { ...cur.source, width: info.width, height: info.height, hasAudio: info.hasAudio, durationSec: info.durationSec },
        job: { status: "ready", progress: 1, message: "Following live", updatedAt: Date.now(), stages: cur.job.stages },
      }));
    });

    // While it grows: its length, then captions and AI clips for the new part (after a
    // failure, captions pause for two minutes and the project says why).
    let captions: Promise<void> | null = null;
    let pausedUntil = 0;
    let known = 0;
    while (ended === null) {
      await sleep(5000, signal);
      await sync();
      const captured = await liveCaptured(userId, projectId);
      if (captured - known >= 1) {
        known = captured;
        await mutateProject(userId, projectId, (cur) => ({ ...cur, source: { ...cur.source, durationSec: captured } }));
      }
      if (!captions && Date.now() >= pausedUntil) {
        captions = followWork(userId, projectId, false, signal, () => stop.abort())
          .then(() => clearCaptionsPaused(userId, projectId))
          .catch(async (err: unknown) => {
            if (signal.aborted || isAbortError(err)) return;
            console.error("[bamio/live] captions for the stream failed", err);
            pausedUntil = Date.now() + 2 * 60_000;
            await mutateProject(userId, projectId, (cur) => ({ ...cur, job: { ...cur.job, warning: `${CAPTIONS_PAUSED} ${errorText(err)} Bamio tries again in a few minutes.` } })).catch(
              () => undefined,
            );
          })
          .finally(() => {
            captions = null;
          });
      }
    }
    await capture;
    await sync();
    await captions;
  } catch (err) {
    stop.abort();
    if (signal.aborted) return;
    // Let ffmpeg close its files before anything is removed.
    await capture;
    const project = await getProject(userId, projectId).catch(() => null);
    if (!project || !isPrepared(project)) {
      console.error("[bamio/live] following never got going", err);
      await failFollow(userId, projectId, errorText(err));
      return;
    }
    console.error("[bamio/live] following failed", err);
    ended = "error";
  }
  await mutateProject(userId, projectId, (cur) => {
    const live = cur.source.live;
    if (!live?.follow) return cur;
    return { ...cur, source: { ...cur.source, live: { ...live, follow: { ...live.follow, status: "finishing", endReason: ended ?? "ended", endedAt: Date.now() } } } };
  });
  await finishFollow(userId, projectId, signal);
}

const CAPTIONS_PAUSED = "Captions paused:";
const MINUTES_OUT = "This month’s AI minutes ran out, so Bamio stopped following the stream and captioning it. Upgrade on the Pricing page for more.";

async function clearCaptionsPaused(userId: string, projectId: string) {
  await mutateProject(userId, projectId, (cur) => (cur.job.warning?.startsWith(CAPTIONS_PAUSED) ? { ...cur, job: { ...cur.job, warning: undefined } } : cur));
}

/**
 * Transcribe a followed stream's new speech (pieces of up to 10 minutes, the first one
 * detecting the language) and look for AI clips in it every 40 minutes of speech, until
 * caught up with the live edge; with `final`, to the very end. Each piece counts against
 * the plan's AI minutes; when they run out, following stops (what was captured is kept).
 */
async function followWork(userId: string, projectId: string, final: boolean, signal: AbortSignal, stopFollowing: () => void = () => undefined) {
  const transcribeDir = `${scratch(projectId).transcribe}-live`;
  for (;;) {
    const project = await getProject(userId, projectId);
    if (!project.source.hasAudio || !localTranscriptionOn()) return;
    const from = project.transcribedSec ?? 0;
    const edge = project.source.durationSec - (final ? 0 : LIVE_EDGE_SEC);
    if (edge - from < (final ? 0.5 : FOLLOW_PIECE_SEC.min)) break;
    if ((await secondsLeft(userId)) <= 0) {
      stopFollowing();
      await mutateProject(userId, projectId, (cur) => ({ ...cur, job: { ...cur.job, warning: MINUTES_OUT } }));
      break;
    }
    const to = Math.min(edge, from + FOLLOW_PIECE_SEC.max);
    const piece = await limits.live(
      () =>
        withSourceFile(userId, project, (file) =>
          transcribeLocal(file, transcribeDir, project.spokenLanguage ?? project.language, signal, () => undefined, { start: from, end: to }),
        ),
      await queuePriority(userId),
    );
    const { keep, until } = commitPiece(piece.segments, from, to, final && to >= edge - 0.01);
    await recordUsage(userId, `${projectId}@${from.toFixed(1)}`, until - from);
    await mutateProject(userId, projectId, async (cur) => {
      const before = cur.hasTranscript ? ((await readTranscript(userId, projectId))?.segments ?? []) : [];
      await writeTranscript(userId, projectId, { language: piece.language, segments: [...before.filter((s) => s.end <= from + 0.01), ...keep] });
      return {
        ...cur,
        hasTranscript: true,
        transcriptEngine: "device",
        // The oldest transcriber that made part of it.
        transcriber: cur.hasTranscript ? Math.min(cur.transcriber ?? 1, TRANSCRIBER_VERSION) : TRANSCRIBER_VERSION,
        captionTiming: "synced",
        spokenLanguage: piece.language ?? cur.spokenLanguage,
        transcribedSec: until,
      };
    });
  }
  // AI clips in the speech since the last look.
  const project = await getProject(userId, projectId);
  const since = project.clipsFoundSec ?? 0;
  const upTo = project.transcribedSec ?? 0;
  if (!project.findClips || !aiConfigured() || upTo - since < (final ? 30 : FOLLOW_FIND_EVERY_SEC)) return;
  const transcript = await readTranscript(userId, projectId);
  const segments = (transcript?.segments ?? []).filter((s) => s.start >= since - 60 && s.end <= upTo);
  if (segments.length > 0) {
    const note = await findClipsStep(userId, projectId, segments, signal, upTo - since);
    if (note) console.warn("[bamio/live] finding clips:", note);
  }
  await mutateProject(userId, projectId, (cur) => ({ ...cur, clipsFoundSec: upTo }));
}

/** A follow that never produced usable video: failed (Try again starts over). */
async function failFollow(userId: string, projectId: string, error: string) {
  await clearLive(userId, projectId).catch(() => undefined);
  const project = await mutateProject(userId, projectId, (cur) => {
    const live = cur.source.live;
    return {
      ...cur,
      source: live?.follow ? { ...cur.source, live: { ...live, follow: { ...live.follow, status: "ended", endReason: "error", endedAt: Date.now() } } } : cur.source,
      job: { status: "failed", progress: 0, message: "Failed", error, updatedAt: Date.now(), stages: cur.job.stages },
    };
  }).catch(() => null);
  if (project) await emailFailed(userId, project, `video-failed:${projectId}:stream`);
}

/** The end of following: the last captions and clips, then one MP4 in place of the HLS. */
async function finishFollow(userId: string, projectId: string, signal: AbortSignal) {
  const keys = mediaKeys(userId, projectId);
  const work = scratch(projectId);
  if (!isPrepared(await getProject(userId, projectId)) || (await liveCaptured(userId, projectId)) <= 0) {
    await failFollow(userId, projectId, "Bamio couldn’t record that stream. It may have ended or be restricted.");
    return;
  }
  try {
    await mkdir(work.dir, { recursive: true });
    const captured = await liveCaptured(userId, projectId);
    if (captured > 0) await mutateProject(userId, projectId, (cur) => ({ ...cur, source: { ...cur.source, durationSec: captured } }));
    let warning: string | undefined;
    try {
      await followWork(userId, projectId, true, signal);
    } catch (err) {
      if (signal.aborted || isAbortError(err)) throw err;
      console.error("[bamio/live] last captions failed", err);
      warning = `The last captions were skipped: ${errorText(err)}`;
    }
    const project = await getProject(userId, projectId);
    await withSourceFile(userId, project, async (file) => {
      const info = await probe(file, signal);
      await prepareSource(file, work.prepared, info, { live: true, signal });
    });
    const prepared = await probe(work.prepared, signal);
    await storage().publish(keys.source, work.prepared, "video/mp4");
    await mutateProject(userId, projectId, (cur) => {
      const live = cur.source.live;
      const note = cur.job.warning?.startsWith(CAPTIONS_PAUSED) ? undefined : cur.job.warning;
      return {
        ...cur,
        source: {
          ...cur.source,
          width: prepared.width,
          height: prepared.height,
          hasAudio: prepared.hasAudio,
          durationSec: prepared.durationSec,
          live: live?.follow ? { ...live, follow: { ...live.follow, status: "ended" } } : live,
        },
        job: { ...cur.job, warning: warning ?? note, updatedAt: Date.now() },
      };
    });
    await clearLive(userId, projectId);
    await rm(work.dir, { recursive: true, force: true });
    await emailReady(userId, projectId, warning);
  } catch (err) {
    if (signal.aborted || isAbortError(err)) return;
    console.error("[bamio/live] finishing failed", err);
    // Left "finishing" with its HLS video, so opening the project tries again (resumeFollow).
    await mutateProject(userId, projectId, (cur) => ({ ...cur, job: { ...cur.job, warning: `Finishing the stream’s video failed: ${errorText(err)} Bamio tries again.` } })).catch(
      () => undefined,
    );
  }
}

/* ------------------------------ Exports ------------------------------ */

/** Queue an export of one clip. The clip's export state tracks progress. */
export async function startExport(userId: string, projectId: string, clipId: string): Promise<Project> {
  const version = Date.now();
  const priority = await queuePriority(userId);
  return mutateProject(
    userId,
    projectId,
    (p) => {
      if (p.job.status !== "ready") throw new HttpError(409, "not_ready", "Wait for the video to finish processing.");
      const clip = p.clips.find((c) => c.id === clipId);
      if (!clip) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
      if (clip.export?.status === "queued" || clip.export?.status === "rendering") throw new HttpError(409, "busy", "This clip is already exporting.");
      const signature = exportSignature(clip, p.transcriptRev);
      return { ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, export: { status: "queued", progress: 0, version, signature } } : c)) };
    },
    { then: (tx) => enqueue({ kind: "export", userId, projectId, clipId, payload: { version }, priority, maxAttempts: 2 }, tx) },
  );
}

/** Changes this export's state (not a newer export of the same clip). */
const exportWriter = (userId: string, projectId: string, clipId: string, version: number) => (state: Partial<NonNullable<Clip["export"]>>) =>
  mutateProject(userId, projectId, (p) => ({
    ...p,
    clips: p.clips.map((c) => (c.id === clipId && c.export?.version === version ? { ...c, export: { ...c.export, ...state } } : c)),
  }));

async function runExport(userId: string, projectId: string, clipId: string, version: number, signal: AbortSignal) {
  const setExport = exportWriter(userId, projectId, clipId, version);
  let last = 0;
  signal.throwIfAborted();
  const current = await getProject(userId, projectId);
  const clip = current.clips.find((c) => c.id === clipId);
  if (!clip || clip.export?.version !== version) return; // deleted, or exported again since
  // The render uses the clip as it is now, which may be newer than when it was queued.
  await setExport({ status: "rendering", progress: 0, signature: exportSignature(clip, current.transcriptRev) });
  const transcript = clip.edit.captions && current.hasTranscript ? await readTranscript(userId, projectId) : null;
  const lines = transcript ? captionLines(transcript.segments, clip.start, clip.end, clip.edit.captionStyle) : [];
  const title = overlayTitle(clip);
  const duration = clip.end - clip.start;
  // Other scripts get their own fonts (downloaded the first time they're needed).
  const language = transcript?.language ?? current.spokenLanguage;
  const fonts = await Promise.all(fontsNeeded([...lines.flatMap((l) => l.words.map((w) => w.text)), title], language).map(ensureFont));
  const ass =
    lines.length > 0 || title
      ? buildAss({
          lines,
          aspect: clip.edit.aspect,
          style: clip.edit.captionStyle,
          position: clip.edit.captionPosition,
          durationSec: duration,
          title,
          markup: (text, size) => assMarkup(text, size, language),
        })
      : null;
  const target = mediaKeys(userId, projectId).export(clipId);
  const render = scratch(projectId).render(clipId);
  // A followed stream renders from its video so far.
  await withSourceFile(userId, current, (input) =>
    renderClip(
      {
        input,
        output: render.output,
        workDir: render.workDir,
        start: clip.start,
        duration,
        srcW: current.source.width,
        srcH: current.source.height,
        hasAudio: current.source.hasAudio,
        edit: clip.edit,
        ass,
        fonts,
      },
      {
        signal,
        onProgress: (v) => {
          const now = Date.now();
          if (now - last < 750) return;
          last = now;
          void setExport({ progress: v }).catch(() => undefined);
        },
      },
    ),
  );
  const bytes = await storage().publish(target, render.output, "video/mp4");
  await setExport({ status: "done", progress: 1, bytes, at: Date.now(), error: undefined });
}

/* ------------------------------ Stopping ------------------------------ */

/** Stop an export and wait (briefly) for its worker to let go of its files. */
export async function stopExport(projectId: string, clipId: string) {
  if ((await requestCancel(projectId, { kind: "export", clipId })) > 0) await waitForIdle(projectId, 5_000, { kind: "export", clipId });
}

/** Stop everything running for a project (before deleting it), and wait briefly for it to stop. */
export async function stopProject(projectId: string) {
  if ((await requestCancel(projectId)) > 0) await waitForIdle(projectId, 5_000);
}

/** Refuse new work when the disk is nearly full: the scratch folder's, and the data folder's when media are kept there. */
export async function assertDiskSpace(bytesNeeded: number) {
  for (const root of storage().name === "local" ? [workRoot(), dataRoot()] : [workRoot()]) {
    try {
      await mkdir(root, { recursive: true });
      const fs = await statfs(root);
      const free = Number(fs.bavail) * Number(fs.bsize);
      if (free < bytesNeeded + 512 * 1024 * 1024) throw new HttpError(507, "no_space", "The server is running out of disk space. Delete some projects first.");
    } catch (err) {
      if (err instanceof HttpError) throw err;
      // statfs can fail on unusual file systems; don't block the user on it.
    }
  }
}

/* ------------------------------ Workers ------------------------------ */

const HOUR = 3600_000;
const slots = (name: string, fallback: number) => Math.max(1, Number(process.env[name]) || fallback);

/** What a worker does with each kind of job (worker.ts runs them). */
export const jobSpecs: Record<JobKind, KindSpec> = {
  import: {
    run: (job, { signal, stopSignal }) => runImport(job.userId, job.projectId, signal, stopSignal),
    failed: (job, err) => importFailed(job.userId, job.projectId, job.id, err),
    retrying: (job, err, delayMs) => importRetrying(job.userId, job.projectId, err, delayMs),
    timeoutMs: 8 * HOUR,
  },
  analyze: { run: (job, { signal }) => runAnalysis(job.userId, job.projectId, signal), timeoutMs: 6 * HOUR },
  retranscribe: { run: (job, { signal }) => runRetranscribe(job.userId, job.projectId, signal), timeoutMs: 6 * HOUR },
  export: {
    run: (job, { signal }) => runExport(job.userId, job.projectId, job.clipId ?? "", Number(job.payload.version), signal),
    failed: async (job, err) => {
      if (!(err instanceof HttpError)) console.error("[bamio/jobs] export failed", err);
      await exportWriter(job.userId, job.projectId, job.clipId ?? "", Number(job.payload.version))({ status: "failed", error: errorText(err) });
    },
    retrying: (job) => exportWriter(job.userId, job.projectId, job.clipId ?? "", Number(job.payload.version))({ status: "queued", progress: 0 }).then(() => undefined),
    timeoutMs: 2 * HOUR,
  },
  follow: {
    run: (job, { signal, stopSignal }) => followProject(job.userId, job.projectId, signal, stopSignal, job.attempts > 1),
    failed: (job, err) => failFollow(job.userId, job.projectId, errorText(err)),
    timeoutMs: (LIMITS.maxFollowSec + 2 * 3600) * 1000,
  },
  "finish-follow": { run: (job, { signal }) => finishFollow(job.userId, job.projectId, signal), timeoutMs: 6 * HOUR },
};

/**
 * Slots per worker process: imports and analysis (each uses several CPU threads to
 * transcribe), exports, followed streams (mostly waiting on the network). One user takes at
 * most two of a kind at once.
 */
export const jobPools = (): Pool[] => [
  { name: "imports", kinds: ["import", "analyze", "retranscribe"], concurrency: slots("BAMIO_IMPORT_SLOTS", 2), perUserMax: 2 },
  { name: "exports", kinds: ["export"], concurrency: slots("BAMIO_EXPORT_SLOTS", 2), perUserMax: 2 },
  { name: "streams", kinds: ["follow", "finish-follow"], concurrency: slots("BAMIO_STREAM_SLOTS", 4), perUserMax: 2 },
];
