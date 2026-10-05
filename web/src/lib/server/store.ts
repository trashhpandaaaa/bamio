import "server-only";
import { rm } from "node:fs/promises";
import path from "node:path";
import type postgres from "postgres";
import type { z } from "zod";
import { planIdSchema, type PlanId } from "@/lib/billing/plans";
import { DEFAULT_EDIT, clipEditSchema, projectSchema, transcriptSchema, isJobActive, type ClipEdit, type ClipLength, type Job, type Language, type Project, type Source, type Transcript } from "@/lib/clips/schema";
import { newId } from "@/lib/ids";
import { db, type Tx } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { activeJobs, type JobKind } from "@/lib/server/queue";
import { storage } from "@/lib/server/storage";

/*
 * Projects, transcripts, billing and usage live in Postgres (db.ts; tables in web/db/migrations).
 * A project's media are in storage (storage.ts: local files or S3), under
 *   users/<userId>/projects/<projectId>/  source.mp4  thumb.jpg  frames/  exports/  upload.bin  live/
 * and work in progress in a scratch folder on the machine doing it (scratch()).
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
export const isUserId = (id: string) => USER_ID.test(id);

function accountDir(userId: string) {
  if (!USER_ID.test(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  return path.join(dataRoot(), "users", userId);
}

function userDir(userId: string) {
  return path.join(accountDir(userId), "projects");
}

/** A project's folder. Ids are validated so a path can never leave the data folder. */
export function projectDir(userId: string, projectId: string) {
  if (!isProjectId(projectId)) throw new HttpError(404, "not_found", "That project doesn’t exist.");
  return path.join(userDir(userId), projectId.toLowerCase());
}

/** Every media key of a user (deleting the account). The id is validated, so it can't name anything else. */
export function userMediaPrefix(userId: string) {
  accountDir(userId);
  return `users/${userId}`;
}

/**
 * Where a project's media are kept (storage.ts): keys in the same layout as the data folder,
 * so with local storage they're the same files as before.
 */
export function mediaKeys(userId: string, projectId: string) {
  projectDir(userId, projectId); // validates both ids
  const base = `users/${userId}/projects/${projectId.toLowerCase()}`;
  return {
    prefix: base,
    source: `${base}/source.mp4`,
    thumb: `${base}/thumb.jpg`,
    /** An upload while it arrives. */
    upload: `${base}/upload.bin`,
    /** A followed stream while it grows: HLS (source.m3u8 and seg-NNNNNN.ts). */
    live: `${base}/live`,
    /** A frame at a time in tenths of a second (clip cards, the trim bar). */
    frame: (tenths: number) => `${base}/frames/${Math.max(0, Math.round(tenths))}.jpg`,
    export: (clipId: string) => {
      if (!CLIP_ID.test(clipId)) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
      return `${base}/exports/${clipId.toLowerCase()}.mp4`;
    },
  };
}

/** Scratch space on this machine for work in progress (downloads, transcription, renders): BAMIO_WORK_DIR, or web/.work. */
export const workRoot = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.BAMIO_WORK_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".work"));

export function scratch(projectId: string) {
  if (!isProjectId(projectId)) throw new HttpError(404, "not_found", "That project doesn’t exist.");
  const dir = path.join(workRoot(), projectId.toLowerCase());
  return {
    dir,
    download: path.join(dir, "download"),
    /** The prepared video, before it goes to storage. */
    prepared: path.join(dir, "source.mp4"),
    thumb: path.join(dir, "thumb.jpg"),
    frames: path.join(dir, "frames"),
    audio: path.join(dir, "audio"),
    transcribe: path.join(dir, "transcribe"),
    /** A followed stream's HLS on the machine capturing it (with object storage; local storage writes it in place). */
    live: path.join(dir, "live"),
    render: (clipId: string) => ({ output: path.join(dir, "exports", `${clipId}.mp4`), workDir: path.join(dir, `export-${clipId}`) }),
  };
}

/* --------------------------- Work in progress --------------------------- */

/** A project's queued or running jobs (from the jobs table): which kinds, and which clips are exporting. */
type Active = { kinds: Set<JobKind>; clips: Set<string> } | undefined;
const PROJECT_WORK: JobKind[] = ["import", "analyze", "retranscribe", "follow", "finish-follow"];
/** A state written just before its job is queued isn't stalled yet. */
const QUEUE_GRACE_MS = 60_000;

/** True once source.mp4 has been made and measured. */
export const isPrepared = (project: Project) => project.source.width > 0 && project.source.durationSec > 0;

/** An upload with no new data for this long is treated as abandoned. */
const UPLOAD_IDLE_MS = 30 * 60 * 1000;

/**
 * Work recorded as in progress with no job queued or running for it was cut off (its job
 * failed for good without saying so, or it predates the job queue). Report it as failed so
 * the user can retry instead of waiting forever.
 */
function reconcile(project: Project, active: Active, now = Date.now()): Project {
  let next = project;
  const status = project.job.status;
  const working = PROJECT_WORK.some((k) => active?.kinds.has(k));
  const stalled =
    status === "uploading"
      ? now - project.job.updatedAt > UPLOAD_IDLE_MS
      : isJobActive(status) && !working && now - project.job.updatedAt > QUEUE_GRACE_MS;
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
  // A followed stream whose capture was cut off: what was captured gets finished (see resumeFollow in jobs.ts).
  const follow = next.source.live?.follow;
  if (follow && (follow.status === "following" || follow.status === "finishing") && !active?.kinds.has("follow") && !active?.kinds.has("finish-follow")) {
    const live = next.source.live!;
    next = {
      ...next,
      source: { ...next.source, live: { ...live, follow: { ...follow, status: "finishing", endReason: follow.endReason ?? "restart", endedAt: follow.endedAt ?? now } } },
    };
  }
  const clips = next.clips.map((clip) => {
    const state = clip.export?.status;
    if ((state === "queued" || state === "rendering") && !active?.clips.has(clip.id) && now - (clip.export?.version ?? 0) > QUEUE_GRACE_MS) {
      return { ...clip, export: { ...clip.export!, status: "failed" as const, error: "The export stopped. Try again." } };
    }
    return clip;
  });
  return clips.some((c, i) => c !== next.clips[i]) ? { ...next, clips } : next;
}

/* ------------------------------ Projects ------------------------------ */

/** A stored document, validated; null (and logged) if it no longer fits the schema. */
function parseProject(raw: unknown, id: string): Project | null {
  const parsed = projectSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  console.error(`[bamio/store] project ${id} failed validation`, parsed.error.issues.slice(0, 3));
  return null;
}

/** Read a project owned by `userId`, or null. Another user's project id finds nothing. */
export async function readProject(userId: string, projectId: string): Promise<Project | null> {
  projectDir(userId, projectId); // validates both ids
  const [row] = await db()<{ data: unknown }[]>`select data from projects where id = ${projectId} and user_id = ${userId}`;
  if (!row) return null;
  const project = parseProject(row.data, projectId);
  return project ? reconcile(project, (await activeJobs([projectId])).get(projectId)) : null;
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
    language: input.language ?? "auto",
    defaultEdit: clipEditSchema.parse({ ...DEFAULT_EDIT, ...input.edit, titleText: "" }),
    hasTranscript: false,
    transcriptRev: 0,
    upload: input.upload,
    clips: [],
  };
}

/** `maxProjects`: how many projects the user may keep (their plan's, with billing on). */
export async function createProject(userId: string, project: Project, maxProjects = MAX_PROJECTS_PER_USER) {
  mediaKeys(userId, project.id); // validates both ids
  const doc = projectSchema.parse(project);
  await db().begin(async (tx) => {
    // One create at a time per user, so two at once can't both pass the count.
    await tx`select pg_advisory_xact_lock(hashtext(${`projects:${userId}`}))`;
    const [{ count } = { count: 0 }] = await tx<{ count: number }[]>`select count(*)::int as count from projects where user_id = ${userId}`;
    if (count >= maxProjects) throw new HttpError(409, "too_many", count === 1 ? "You have 1 project, the most you can keep now. Delete it to import another, or choose a plan to keep more." : `You have ${count} projects, the most you can keep. Delete one to import another.`);
    await tx`insert into projects (id, user_id, data, created_at, updated_at) values (${doc.id}, ${userId}, ${tx.json(asJson(doc))}, ${doc.createdAt}, ${doc.updatedAt})`;
  });
}

/**
 * Read, change and write a project with no other change in between: the row stays locked
 * until the change is written, across every server and worker. `change` may throw an
 * HttpError to refuse the change (nothing is written). `then` runs in the same transaction
 * after the write (queue the job for a state just written: both happen, or neither).
 */
export function mutateProject(
  userId: string,
  projectId: string,
  change: (project: Project) => Project | Promise<Project>,
  opts: { then?: (tx: Tx, project: Project) => Promise<unknown> } = {},
): Promise<Project> {
  projectDir(userId, projectId);
  return db().begin(async (tx) => {
    // NO KEY UPDATE: other rows can still reference this one meanwhile (a transcript written inside `change`).
    const [row] = await tx<{ data: unknown }[]>`select data from projects where id = ${projectId} and user_id = ${userId} for no key update`;
    const current = row ? parseProject(row.data, projectId) : null;
    if (!current) throw new HttpError(404, "not_found", "That project doesn’t exist, or it was deleted.");
    const active = (await activeJobs([projectId], tx)).get(projectId);
    const updated = projectSchema.parse({ ...(await change(reconcile(current, active))), updatedAt: Date.now() });
    await tx`update projects set data = ${tx.json(asJson(updated))}, updated_at = ${updated.updatedAt} where id = ${projectId}`;
    await opts.then?.(tx, updated);
    return updated;
  });
}

export async function listProjects(userId: string): Promise<Project[]> {
  if (!USER_ID.test(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  const rows = await db()<{ id: string; data: unknown }[]>`select id, data from projects where user_id = ${userId} order by updated_at desc`;
  const projects = rows.map((r) => parseProject(r.data, r.id)).filter((p): p is Project => p !== null);
  const active = await activeJobs(projects.map((p) => p.id));
  return projects.map((p) => reconcile(p, active.get(p.id)));
}

export async function countProjects(userId: string): Promise<number> {
  if (!USER_ID.test(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  const [{ count } = { count: 0 }] = await db()<{ count: number }[]>`select count(*)::int as count from projects where user_id = ${userId}`;
  return count;
}

/** The project's record (and its transcript), then its media and any scratch files. */
export async function deleteProject(userId: string, projectId: string) {
  const keys = mediaKeys(userId, projectId);
  const deleted = await db()`delete from projects where id = ${projectId} and user_id = ${userId}`;
  if (deleted.count === 0) return;
  await storage().removePrefix(keys.prefix);
  await rm(scratch(projectId).dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/* ----------------------------- Transcripts ----------------------------- */

export async function readTranscript(userId: string, projectId: string): Promise<Transcript | null> {
  projectDir(userId, projectId);
  const [row] = await db()<{ data: unknown }[]>`
    select t.data from transcripts t join projects p on p.id = t.project_id
    where t.project_id = ${projectId} and p.user_id = ${userId}`;
  if (!row) return null;
  const parsed = transcriptSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

export async function writeTranscript(userId: string, projectId: string, transcript: Transcript) {
  projectDir(userId, projectId);
  const doc = transcriptSchema.parse(transcript);
  const sql = db();
  const written = await sql`
    insert into transcripts (project_id, data, updated_at)
    select id, ${sql.json(asJson(doc))}, ${Date.now()} from projects where id = ${projectId} and user_id = ${userId}
    on conflict (project_id) do update set data = excluded.data, updated_at = excluded.updated_at`;
  if (written.count === 0) throw new HttpError(404, "not_found", "That project doesn’t exist, or it was deleted.");
}

/* ------------------------------ Billing ------------------------------ */

/** The user's billing record (the Stripe customer and subscription; billing.ts owns its shape), or null. */
export async function readBilling<T>(userId: string, schema: z.ZodType<T>): Promise<T | null> {
  if (!USER_ID.test(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  const [row] = await db()<{ data: unknown }[]>`select data from billing_accounts where user_id = ${userId}`;
  if (!row) return null;
  const parsed = schema.safeParse(row.data);
  if (!parsed.success) {
    console.error(`[bamio/store] billing of ${userId} failed validation`, parsed.error.issues.slice(0, 3));
    return null;
  }
  return parsed.data;
}

/**
 * Read, change and write the billing record with no other change in between. `change` may
 * throw to leave it as it was. `then` runs in the same transaction with the record before and
 * after (to queue the emails a change calls for).
 */
export function updateBilling<T>(
  userId: string,
  schema: z.ZodType<T>,
  change: (current: T | null) => T | Promise<T>,
  opts: { then?: (tx: Tx, updated: T, previous: T | null) => Promise<unknown> } = {},
): Promise<T> {
  if (!USER_ID.test(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  return db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`billing:${userId}`}))`;
    const [row] = await tx<{ data: unknown }[]>`select data from billing_accounts where user_id = ${userId}`;
    const parsed = row ? schema.safeParse(row.data) : null;
    const previous = parsed?.success ? parsed.data : null;
    const updated = schema.parse(await change(previous));
    await tx`
      insert into billing_accounts (user_id, data, updated_at) values (${userId}, ${tx.json(asJson(updated))}, ${Date.now()})
      on conflict (user_id) do update set data = excluded.data, updated_at = excluded.updated_at`;
    await opts.then?.(tx, updated, previous);
    return updated;
  }) as Promise<T>;
}

/** A plan given to the user without paying (scripts/grant-plan.mjs), or null. `since`: when, which sets the day their minutes renew. */
export async function readPlanGrant(userId: string): Promise<{ plan: PlanId; since: number } | null> {
  if (!USER_ID.test(userId)) return null;
  const [row] = await db()<{ plan: string; created_at: number }[]>`select plan, created_at::float8 as created_at from plan_grants where user_id = ${userId}`;
  const plan = planIdSchema.safeParse(row?.plan);
  return row && plan.success ? { plan: plan.data, since: row.created_at } : null;
}

/* ------------------------------ Usage ------------------------------ */

/** Count `sec` of AI processing for `key` (an import, a stream piece). Counting the same key again does nothing. */
export async function addUsage(userId: string, key: string, sec: number, at = Date.now()) {
  if (!USER_ID.test(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  await db()`insert into usage_entries (user_id, key, sec, at) values (${userId}, ${key}, ${sec}, ${at}) on conflict (user_id, key) do nothing`;
}

/** Seconds of AI processing counted in [start, end). */
export async function usageBetween(userId: string, start: number, end: number): Promise<number> {
  const [{ sec } = { sec: 0 }] = await db()<{ sec: number }[]>`
    select coalesce(sum(sec), 0)::float8 as sec from usage_entries where user_id = ${userId} and at >= ${start} and at < ${end}`;
  return sec;
}

export async function hasUsage(userId: string, key: string): Promise<boolean> {
  const [row] = await db()`select 1 from usage_entries where user_id = ${userId} and key = ${key}`;
  return Boolean(row);
}

/** A validated document as postgres.js's JSON type (it's plain JSON: no dates, functions or undefined left after JSON round-trips). */
function asJson(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}
