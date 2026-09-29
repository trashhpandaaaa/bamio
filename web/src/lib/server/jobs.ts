import "server-only";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, statfs } from "node:fs/promises";
import { clipTarget, findHighlights, transcribeChunk, tidySegments } from "@/lib/ai/server/clips-ai";
import { aiConfigured } from "@/lib/ai/server/gemini";
import { buildAss } from "@/lib/clips/ass";
import { captionLines, exportSignature, overlayTitle } from "@/lib/clips/logic";
import { LIMITS, type Clip, type ClipLength, type JobStatus, type Project, type Segment, type Transcript } from "@/lib/clips/schema";
import { isAbortError } from "@/lib/server/bin";
import { assMarkup, ensureFont, fontsNeeded } from "@/lib/server/caption-fonts";
import { HttpError } from "@/lib/server/http";
import { downloadUrl, extractAudioChunks, extractFrame, prepareSource, probe, renderClip } from "@/lib/server/media";
import { relocateAiClips } from "@/lib/clips/relocate";
import { recordLive } from "@/lib/server/live";
import { localTranscriptionOn, transcribeLocal } from "@/lib/server/transcribe";
import {
  clipFile,
  dataRoot,
  exportKey,
  getProject,
  isPrepared,
  mutateProject,
  paths,
  readTranscript,
  running,
  writeTranscript,
  type RunningTask,
} from "@/lib/server/store";
import { newId } from "@/lib/ids";

/*
 * Background work, run inside the Next.js server process: imports (download or
 * upload, prepare, transcribe, find clips) and exports. Progress is written to the
 * project file, which the browser polls.
 */

type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

function limiter(max: number): Limiter {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

type Limiters = { imports: Limiter; exports: Limiter; frames: Limiter };
const limits: Limiters = ((globalThis as { __bamioLimits?: Limiters }).__bamioLimits ??= {
  imports: limiter(2),
  exports: limiter(2),
  frames: limiter(3),
});

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
  const set = (status: JobStatus, progress: number, message: string, extra: { warning?: string; error?: string } = {}) =>
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

/* ------------------------------ Imports ------------------------------ */

function track(map: Map<string, RunningTask>, key: string, work: (signal: AbortSignal) => Promise<void>) {
  const controller = new AbortController();
  const done = work(controller.signal).finally(() => {
    if (map.get(key)?.controller === controller) map.delete(key);
  });
  map.set(key, { controller, done });
  void done.catch(() => undefined);
}

/** Start (or restart) processing a project. Does nothing if it is already running. */
export function startImport(userId: string, projectId: string) {
  if (running.imports.has(projectId)) return;
  track(running.imports, projectId, (signal) => limits.imports(() => runImport(userId, projectId, signal)));
}

/** Transcribe (if needed) and find clips on a project that is already imported. */
export async function startAnalysis(userId: string, projectId: string, clipLength: ClipLength): Promise<Project> {
  if (running.imports.has(projectId)) throw new HttpError(409, "busy", "This project is still processing.");
  // Queued before the task is registered, so the change and the registry entry land together.
  const queued = mutateProject(userId, projectId, (p) => {
    if (p.job.status !== "ready" || !isPrepared(p)) throw new HttpError(409, "not_ready", "Wait for the video to finish processing.");
    const stages = plannedStages(p, { findClips: true });
    return { ...p, clipLength, findClips: true, job: { status: "queued", progress: 0, message: "Waiting to start", updatedAt: Date.now(), stages } };
  });
  track(running.imports, projectId, async (signal) => {
    const job = jobWriter(userId, projectId);
    try {
      await queued;
    } catch {
      return;
    }
    try {
      const warning = await limits.imports(() => analyze(userId, projectId, signal, { findClips: true }));
      await job.set("ready", 1, "Ready", { warning });
    } catch (err) {
      if (signal.aborted) return;
      await job.set("ready", 1, "Ready", { warning: `Finding clips failed: ${errorText(err)}` }).catch(() => undefined);
    }
  });
  return queued;
}

/**
 * Transcribe an imported video again on this device, replacing its transcript. For
 * projects transcribed before on-device transcription (English before 2026-09-28, other
 * languages before 2026-09-29), whose timing was approximate. Clips are kept; their
 * captions follow the new transcript.
 */
export async function startRetranscribe(userId: string, projectId: string): Promise<Project> {
  if (running.imports.has(projectId)) throw new HttpError(409, "busy", "This project is still processing.");
  const queued = mutateProject(userId, projectId, (p) => {
    if (p.job.status !== "ready" || !isPrepared(p)) throw new HttpError(409, "not_ready", "Wait for the video to finish processing.");
    if (!p.source.hasAudio) throw new HttpError(409, "no_audio", "This video has no sound to transcribe.");
    return { ...p, job: { status: "queued", progress: 0, message: "Waiting to start", updatedAt: Date.now(), stages: ["transcribing"] } };
  });
  track(running.imports, projectId, async (signal) => {
    const job = jobWriter(userId, projectId);
    try {
      await queued;
    } catch {
      return;
    }
    try {
      let moved = 0;
      await limits.imports(async () => {
        await job.set("transcribing", 0, "Transcribing on this device");
        const files = paths(userId, projectId);
        const before = await readTranscript(userId, projectId);
        const { language } = await getProject(userId, projectId);
        const transcript = await transcribeLocal(files.source, files.transcribe, language, signal, (v, message) => job.progress("transcribing", v, message));
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
            captionTiming: "synced",
            spokenLanguage: transcript.language,
            transcriptRev: cur.transcriptRev + 1,
          };
        });
      });
      const note = moved > 0 ? `Transcribed again. ${moved} AI ${moved === 1 ? "clip was" : "clips were"} moved to where their words are spoken.` : undefined;
      await job.set("ready", 1, "Ready", { warning: note });
    } catch (err) {
      if (signal.aborted) return;
      await job.set("ready", 1, "Ready", { warning: `Transcribing again failed: ${errorText(err)}` }).catch(() => undefined);
    }
  });
  return queued;
}

async function saveTranscript(userId: string, projectId: string, transcript: Transcript, engine: "device" | "gemini") {
  await mutateProject(userId, projectId, async (cur) => {
    await writeTranscript(userId, projectId, transcript);
    return {
      ...cur,
      hasTranscript: true,
      transcriptEngine: engine,
      captionTiming: engine === "device" ? "synced" : "estimated",
      spokenLanguage: transcript.language ?? cur.spokenLanguage,
      transcriptRev: cur.transcriptRev + 1,
    };
  });
}

async function runImport(userId: string, projectId: string, signal: AbortSignal) {
  const job = jobWriter(userId, projectId);
  const p = paths(userId, projectId);
  try {
    signal.throwIfAborted();
    let project = await getProject(userId, projectId);

    if (!isPrepared(project) || !existsSync(p.source)) {
      let original: string;
      if (project.source.live) {
        await job.set("recording", 0, "Starting the recording");
        const stop = new AbortController();
        running.stops.set(projectId, stop);
        try {
          const recorded = await recordLive(project.source, p.download, {
            signal,
            stopSignal: stop.signal,
            onProgress: (value, message) => job.progress("recording", value, message),
          });
          original = recorded.file;
          if (recorded.vodRange) {
            const vodRange = recorded.vodRange;
            await mutateProject(userId, projectId, (cur) => ({ ...cur, source: { ...cur.source, live: cur.source.live ? { ...cur.source.live, vodRange } : undefined } }));
          }
        } finally {
          if (running.stops.get(projectId) === stop) running.stops.delete(projectId);
        }
      } else if (project.source.kind === "url") {
        await job.set("downloading", 0, "Downloading the video");
        original = await downloadUrl(project.source.url ?? "", p.download, {
          range: project.source.range,
          signal,
          onProgress: (value) => value !== null && job.progress("downloading", value, "Downloading the video"),
        });
      } else {
        original = p.upload;
        if (!existsSync(original)) throw new HttpError(409, "upload_missing", "The uploaded file is gone. Upload it again.");
      }

      await job.set("preparing", 0, "Preparing the video");
      const info = await probe(original, signal);
      if (!info.hasVideo) throw new HttpError(422, "no_video", "That file has no video in it.");
      if (info.durationSec < 1) throw new HttpError(422, "too_short", "That video is too short to clip.");
      if (info.durationSec > LIMITS.maxMediaSec + 5) {
        throw new HttpError(422, "too_long", "That video is longer than 3 hours. Import a part of it instead.");
      }
      await prepareSource(original, p.source, info, {
        live: Boolean(project.source.live),
        signal,
        onProgress: (v) => job.progress("preparing", v, "Preparing the video"),
      });
      // Measure the prepared file itself (a remuxed live recording can differ slightly from the capture).
      const prepared = await probe(p.source, signal);
      await extractFrame(p.source, p.thumb, Math.min(prepared.durationSec * 0.1, 8), 640, signal).catch(() => undefined);
      await rm(original, { force: true });
      await rm(p.download, { recursive: true, force: true });
      project = await mutateProject(userId, projectId, (cur) => ({
        ...cur,
        upload: undefined,
        source: { ...cur.source, durationSec: prepared.durationSec, width: prepared.width, height: prepared.height, hasAudio: prepared.hasAudio },
      }));
    }

    const warning = await analyze(userId, projectId, signal, { findClips: project.findClips });
    await job.set("ready", 1, "Ready", { warning });
  } catch (err) {
    if (signal.aborted || isAbortError(err)) return;
    if (!(err instanceof HttpError)) console.error("[bamio/jobs] import failed", err);
    await job.set("failed", 0, "Import failed", { error: errorText(err) }).catch(() => undefined);
  }
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
  } else if (!local && !aiConfigured()) {
    return `Captions and AI clips are off because ${noAi}`;
  } else {
    try {
      let transcript: Transcript;
      if (local) {
        await job.set("transcribing", 0, "Transcribing on this device");
        const files = paths(userId, projectId);
        transcript = await transcribeLocal(files.source, files.transcribe, project.language, signal, (v, message) => job.progress("transcribing", v, message));
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

async function findClipsStep(userId: string, projectId: string, segments: Segment[], signal: AbortSignal): Promise<string | undefined> {
  const job = jobWriter(userId, projectId);
  let project: Project;
  try {
    await job.set("finding", 0, "Finding the best moments");
    project = await getProject(userId, projectId);
    const room = LIMITS.maxClips - project.clips.length;
    if (room <= 0) return `This project already has ${LIMITS.maxClips} clips. Delete some to find more.`;
    const found = await findHighlights({
      segments,
      durationSec: project.source.durationSec,
      clipLength: project.clipLength,
      title: project.title,
      language: project.spokenLanguage,
      avoid: project.clips.map((c) => ({ start: c.start, end: c.end })),
      signal,
    });
    let added = 0;
    await mutateProject(userId, projectId, (cur) => {
      const now = Date.now();
      const fresh = found
        .filter((c) => !cur.clips.some((k) => Math.min(k.end, c.end) - Math.max(k.start, c.start) > 0.5 * Math.min(k.end - k.start, c.end - c.start)))
        .slice(0, Math.min(room, clipTarget(cur.source.durationSec, cur.clipLength)))
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
  const dir = paths(userId, projectId).audio;
  try {
    const chunks = await extractAudioChunks(paths(userId, projectId).source, dir, CHUNK_SEC, signal);
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

/* ------------------------------ Exports ------------------------------ */

/** Queue an export of one clip. The clip's export state tracks progress. */
export async function startExport(userId: string, projectId: string, clipId: string): Promise<Project> {
  const key = exportKey(projectId, clipId);
  if (running.exports.has(key)) throw new HttpError(409, "busy", "This clip is already exporting.");
  const version = Date.now();
  const project = await mutateProject(userId, projectId, (p) => {
    if (p.job.status !== "ready") throw new HttpError(409, "not_ready", "Wait for the video to finish processing.");
    const clip = p.clips.find((c) => c.id === clipId);
    if (!clip) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
    const signature = exportSignature(clip, p.transcriptRev);
    return { ...p, clips: p.clips.map((c) => (c.id === clipId ? { ...c, export: { status: "queued", progress: 0, version, signature } } : c)) };
  });

  track(running.exports, key, (signal) =>
    limits.exports(async () => {
      const setExport = (state: Partial<NonNullable<Clip["export"]>>) =>
        mutateProject(userId, projectId, (p) => ({
          ...p,
          clips: p.clips.map((c) => (c.id === clipId && c.export?.version === version ? { ...c, export: { ...c.export, ...state } } : c)),
        }));
      let last = 0;
      try {
        signal.throwIfAborted();
        const current = await getProject(userId, projectId);
        const clip = current.clips.find((c) => c.id === clipId);
        if (!clip) return;
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
        const bytes = await renderClip(
          {
            input: paths(userId, projectId).source,
            output: clipFile(userId, projectId, clipId, "export"),
            workDir: clipFile(userId, projectId, clipId, "work"),
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
        );
        await setExport({ status: "done", progress: 1, bytes, at: Date.now(), error: undefined });
      } catch (err) {
        if (signal.aborted || isAbortError(err)) return;
        if (!(err instanceof HttpError)) console.error("[bamio/jobs] export failed", err);
        await setExport({ status: "failed", error: errorText(err) }).catch(() => undefined);
      }
    }),
  );
  return project;
}

/* ------------------------------ Stopping ------------------------------ */

/** Stop an export and wait (briefly) for ffmpeg to let go of its files. */
export async function stopExport(projectId: string, clipId: string) {
  const task = running.exports.get(exportKey(projectId, clipId));
  if (!task) return;
  task.controller.abort();
  await Promise.race([task.done.catch(() => undefined), new Promise((r) => setTimeout(r, 5000))]);
}

/** Stop everything running for a project (before deleting it). */
export async function stopProject(projectId: string) {
  const tasks = [running.imports.get(projectId), ...[...running.exports].filter(([k]) => k.startsWith(`${projectId}:`)).map(([, t]) => t)].filter(
    (t): t is RunningTask => Boolean(t),
  );
  tasks.forEach((t) => t.controller.abort());
  await Promise.race([Promise.allSettled(tasks.map((t) => t.done)), new Promise((r) => setTimeout(r, 5000))]);
}

/** Refuse new work when the disk is nearly full. */
export async function assertDiskSpace(bytesNeeded: number) {
  try {
    await mkdir(dataRoot(), { recursive: true });
    const fs = await statfs(dataRoot());
    const free = Number(fs.bavail) * Number(fs.bsize);
    if (free < bytesNeeded + 512 * 1024 * 1024) throw new HttpError(507, "no_space", "The server is running out of disk space. Delete some projects first.");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // statfs can fail on unusual file systems; don't block the user on it.
  }
}
