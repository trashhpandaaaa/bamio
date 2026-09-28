import "server-only";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_EDIT, clipEditSchema, projectSchema, transcriptSchema, isJobActive, type ClipEdit, type ClipLength, type Job, type Language, type Project, type Source, type Transcript } from "@/lib/clips/schema";
import { newId } from "@/lib/ids";
import { HttpError } from "@/lib/server/http";

/*
 * Projects live on the server's disk, one folder per project:
 *   <data>/users/<userId>/projects/<projectId>/
 *     project.json  transcript.json  source.mp4  thumb.jpg  frames/  exports/  (work folders while busy)
 * <data> is BAMIO_DATA_DIR, or web/.data.
 */

const USER_ID = /^[A-Za-z0-9_-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLIP_ID = /^[0-9a-f-]{8,64}$/i;

export const MAX_PROJECTS_PER_USER = 100;

// Runtime data, not part of the build: tell Turbopack not to trace it (both calls, or the
// inner join still resolves to web/.data and the build reads every stored video).
export const dataRoot = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.BAMIO_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data"));

export const isProjectId = (id: string) => UUID.test(id);

function userDir(userId: string) {
  if (!USER_ID.test(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  return path.join(dataRoot(), "users", userId, "projects");
}

/** A project's folder. Ids are validated so a path can never leave the data folder. */
export function projectDir(userId: string, projectId: string) {
  if (!isProjectId(projectId)) throw new HttpError(404, "not_found", "That project doesn’t exist.");
  return path.join(userDir(userId), projectId.toLowerCase());
}

export function clipFile(userId: string, projectId: string, clipId: string, kind: "export" | "work") {
  if (!CLIP_ID.test(clipId)) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
  const dir = projectDir(userId, projectId);
  return kind === "export" ? path.join(dir, "exports", `${clipId}.mp4`) : path.join(dir, "work", `export-${clipId}`);
}

export const paths = (userId: string, projectId: string) => {
  const dir = projectDir(userId, projectId);
  return {
    dir,
    project: path.join(dir, "project.json"),
    transcript: path.join(dir, "transcript.json"),
    source: path.join(dir, "source.mp4"),
    thumb: path.join(dir, "thumb.jpg"),
    frames: path.join(dir, "frames"),
    exports: path.join(dir, "exports"),
    upload: path.join(dir, "upload.bin"),
    download: path.join(dir, "download"),
    audio: path.join(dir, "work", "audio"),
    transcribe: path.join(dir, "work", "transcribe"),
    work: path.join(dir, "work"),
  };
};

/* --------------------------- Running work --------------------------- */

export type RunningTask = { controller: AbortController; done: Promise<unknown> };
type Registry = { imports: Map<string, RunningTask>; exports: Map<string, RunningTask> };

/** Imports and exports running in this server process (kept across dev reloads). */
export const running: Registry = ((globalThis as { __bamioRunning?: Registry }).__bamioRunning ??= {
  imports: new Map(),
  exports: new Map(),
});

export const exportKey = (projectId: string, clipId: string) => `${projectId}:${clipId}`;

/** True once source.mp4 has been made and measured. */
export const isPrepared = (project: Project) => project.source.width > 0 && project.source.durationSec > 0;

/** An upload with no new data for this long is treated as abandoned. */
const UPLOAD_IDLE_MS = 30 * 60 * 1000;

/**
 * Work recorded as in progress but not running here was cut off (server restart or
 * crash). Report it as failed so the user can retry instead of waiting forever.
 */
function reconcile(project: Project, now = Date.now()): Project {
  let next = project;
  const status = project.job.status;
  const stalled =
    status === "uploading" ? now - project.job.updatedAt > UPLOAD_IDLE_MS : isJobActive(status) && !running.imports.has(project.id);
  if (stalled && isPrepared(project)) {
    // The video itself is fine; only captions or AI clips were cut off.
    next = { ...next, job: { status: "ready", progress: 1, message: "Ready", warning: "Processing stopped before it finished. Use Find clips to try again.", updatedAt: now } };
  } else if (stalled) {
    next = {
      ...next,
      job: {
        ...next.job,
        status: "failed",
        error: status === "uploading" ? "The upload stopped before it finished. Upload the file again." : "Processing stopped because the server restarted. Try again.",
        updatedAt: now,
      },
    };
  }
  const clips = next.clips.map((clip) => {
    const state = clip.export?.status;
    if ((state === "queued" || state === "rendering") && !running.exports.has(exportKey(project.id, clip.id))) {
      return { ...clip, export: { ...clip.export!, status: "failed" as const, error: "The export stopped. Try again." } };
    }
    return clip;
  });
  return clips.some((c, i) => c !== next.clips[i]) ? { ...next, clips } : next;
}

/* ------------------------------ Files ------------------------------ */

async function writeAtomic(file: string, data: string) {
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data, "utf8");
  // Windows can refuse a rename while another request is reading the file; retry briefly.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 8 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) {
        await rm(tmp, { force: true });
        throw err;
      }
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}

async function readJsonFile(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/* ------------------------------ Projects ------------------------------ */

/** Read a project owned by `userId`, or null. Ownership is the folder: other users' ids resolve elsewhere. */
export async function readProject(userId: string, projectId: string): Promise<Project | null> {
  const raw = await readJsonFile(paths(userId, projectId).project);
  if (raw === null) return null;
  const parsed = projectSchema.safeParse(raw);
  if (!parsed.success) {
    console.error(`[bamio/store] project ${projectId} failed validation`, parsed.error.issues.slice(0, 3));
    return null;
  }
  return reconcile(parsed.data);
}

export async function getProject(userId: string, projectId: string): Promise<Project> {
  const project = await readProject(userId, projectId);
  if (!project) throw new HttpError(404, "not_found", "That project doesn’t exist, or it was deleted.");
  return project;
}

/** A new project record, before any processing. */
export function blankProject(input: {
  title: string;
  source: Omit<Source, "width" | "height" | "hasAudio">;
  findClips: boolean;
  clipLength: ClipLength;
  language?: Language;
  edit?: Partial<ClipEdit>;
  job: Pick<Job, "status" | "message" | "stages">;
  upload?: Project["upload"];
}): Project {
  const now = Date.now();
  return {
    id: newId(),
    version: 1,
    title: input.title,
    createdAt: now,
    updatedAt: now,
    source: { ...input.source, width: 0, height: 0, hasAudio: false },
    job: { ...input.job, progress: 0, updatedAt: now },
    findClips: input.findClips,
    clipLength: input.clipLength,
    language: input.language ?? "en",
    defaultEdit: clipEditSchema.parse({ ...DEFAULT_EDIT, ...input.edit, titleText: "" }),
    hasTranscript: false,
    transcriptRev: 0,
    upload: input.upload,
    clips: [],
  };
}

export async function createProject(userId: string, project: Project) {
  const list = await listProjects(userId);
  if (list.length >= MAX_PROJECTS_PER_USER) {
    throw new HttpError(409, "too_many", `You have ${MAX_PROJECTS_PER_USER} projects. Delete one to import another.`);
  }
  const p = paths(userId, project.id);
  await mkdir(p.dir, { recursive: true });
  await writeAtomic(p.project, JSON.stringify(projectSchema.parse(project)));
}

const locks: Map<string, Promise<unknown>> = ((globalThis as { __bamioLocks?: Map<string, Promise<unknown>> }).__bamioLocks ??= new Map());

/**
 * Read, change and write a project with no other change in between (per-project
 * queue). `change` may throw an HttpError to refuse the change.
 */
export function mutateProject(userId: string, projectId: string, change: (project: Project) => Project | Promise<Project>): Promise<Project> {
  const key = `${userId}/${projectId}`;
  const previous = locks.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await getProject(userId, projectId);
      const updated = projectSchema.parse({ ...(await change(current)), updatedAt: Date.now() });
      await writeAtomic(paths(userId, projectId).project, JSON.stringify(updated));
      return updated;
    });
  locks.set(key, next);
  void next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  }).catch(() => undefined);
  return next;
}

export async function listProjects(userId: string): Promise<Project[]> {
  let ids: string[];
  try {
    ids = await readdir(userDir(userId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const projects = await Promise.all(ids.filter(isProjectId).map((id) => readProject(userId, id).catch(() => null)));
  return projects.filter((p): p is Project => p !== null).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProjectFiles(userId: string, projectId: string) {
  await rm(paths(userId, projectId).dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/* ----------------------------- Transcripts ----------------------------- */

export async function readTranscript(userId: string, projectId: string): Promise<Transcript | null> {
  const raw = await readJsonFile(paths(userId, projectId).transcript);
  if (raw === null) return null;
  const parsed = transcriptSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function writeTranscript(userId: string, projectId: string, transcript: Transcript) {
  await writeAtomic(paths(userId, projectId).transcript, JSON.stringify(transcriptSchema.parse(transcript)));
}
