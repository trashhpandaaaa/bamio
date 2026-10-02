import "server-only";
import type postgres from "postgres";
import { db, type Sql, type Tx } from "@/lib/server/db";

/*
 * The job queue: rows in the jobs table (web/db/migrations/0002_jobs.sql) that any worker
 * process claims. A claimed job is leased: the worker renews the lease while it runs, and a
 * job whose lease ran out (its worker died) is claimed again by another worker, which
 * resumes it. Failures can be retried later (run_after). One live job per project and kind
 * (per clip for exports), so asking twice finds the first. Workers wake on a notification
 * when a job is queued, and poll as a fallback (worker.ts).
 */

export const JOB_KINDS = ["import", "analyze", "retranscribe", "export", "follow", "finish-follow"] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type JobRow = {
  id: number;
  kind: JobKind;
  userId: string;
  projectId: string;
  clipId: string | null;
  payload: Record<string, unknown>;
  priority: number;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  leaseOwner: string | null;
  leaseUntil: number | null;
  cancelRequested: boolean;
  stopRequested: boolean;
  lastError: string | null;
};

export const JOBS_CHANNEL = "bamio_jobs";
const ACTIVE = ["queued", "running"];

type Row = Record<string, unknown>;
const toJob = (r: Row): JobRow => ({
  id: Number(r.id),
  kind: r.kind as JobKind,
  userId: String(r.user_id),
  projectId: String(r.project_id),
  clipId: (r.clip_id as string | null) ?? null,
  payload: (r.payload as Record<string, unknown>) ?? {},
  priority: Number(r.priority),
  status: r.status as JobStatus,
  attempts: Number(r.attempts),
  maxAttempts: Number(r.max_attempts),
  runAfter: Number(r.run_after),
  leaseOwner: (r.lease_owner as string | null) ?? null,
  leaseUntil: r.lease_until === null || r.lease_until === undefined ? null : Number(r.lease_until),
  cancelRequested: Boolean(r.cancel_requested),
  stopRequested: Boolean(r.stop_requested),
  lastError: (r.last_error as string | null) ?? null,
});

export type NewJob = {
  kind: JobKind;
  userId: string;
  projectId: string;
  clipId?: string;
  payload?: Record<string, unknown>;
  priority?: number;
  maxAttempts?: number;
};

/** Queue a job, or find the one already queued or running for the same project and kind (and clip). */
export async function enqueue(job: NewJob, sql: Sql | Tx = db(), now = Date.now()): Promise<{ id: number; created: boolean }> {
  const clipId = job.clipId ?? null;
  const [row] = await sql<Row[]>`
    insert into jobs (kind, user_id, project_id, clip_id, payload, priority, max_attempts, run_after, created_at, updated_at)
    values (${job.kind}, ${job.userId}, ${job.projectId}, ${clipId}, ${sql.json((job.payload ?? {}) as postgres.JSONValue)}, ${job.priority ?? 0}, ${job.maxAttempts ?? 3}, ${now}, ${now}, ${now})
    on conflict (project_id, kind, coalesce(clip_id, '')) where status in ('queued', 'running') do nothing
    returning id`;
  if (row) {
    await sql`select pg_notify(${JOBS_CHANNEL}, ${job.kind})`;
    return { id: Number(row.id), created: true };
  }
  const [existing] = await sql<Row[]>`
    select id from jobs where project_id = ${job.projectId} and kind = ${job.kind} and coalesce(clip_id, '') = ${clipId ?? ""} and status in ${sql(ACTIVE)}`;
  return { id: Number(existing?.id ?? 0), created: false };
}

/**
 * Claim the next job of these kinds: queued and due, or running with an expired lease (its
 * worker stopped). Highest priority first, then oldest. A user already running `perUserMax`
 * jobs of these kinds waits, so one user can't take every slot.
 */
export async function claim(worker: string, kinds: readonly JobKind[], opts: { leaseMs: number; perUserMax: number }, now = Date.now()): Promise<JobRow | null> {
  const sql = db();
  // Expired jobs asked to cancel aren't run again.
  await sql`update jobs set status = 'cancelled', finished_at = ${now}, updated_at = ${now}, lease_owner = null
    where status = 'running' and lease_until < ${now} and cancel_requested and kind in ${sql(kinds as JobKind[])}`;
  const [row] = await sql<Row[]>`
    update jobs set status = 'running', lease_owner = ${worker}, lease_until = ${now + opts.leaseMs}, attempts = attempts + 1, updated_at = ${now}
    where id = (
      select j.id from jobs j
      where j.kind in ${sql(kinds as JobKind[])}
        and not j.cancel_requested
        and ((j.status = 'queued' and j.run_after <= ${now}) or (j.status = 'running' and j.lease_until < ${now}))
        and (select count(*) from jobs r
             where r.user_id = j.user_id and r.id <> j.id and r.kind in ${sql(kinds as JobKind[])} and r.status = 'running' and r.lease_until >= ${now}) < ${opts.perUserMax}
      order by j.priority desc, j.run_after, j.id
      limit 1
      for update skip locked
    )
    returning *`;
  return row ? toJob(row) : null;
}

/** Renew a running job's lease. `held` false: another worker has it now (or it was deleted); stop working on it. */
export async function heartbeat(id: number, worker: string, leaseMs: number, now = Date.now()): Promise<{ held: boolean; cancel: boolean; stop: boolean }> {
  const [row] = await db()<Row[]>`
    update jobs set lease_until = ${now + leaseMs}, updated_at = ${now}
    where id = ${id} and lease_owner = ${worker} and status = 'running'
    returning cancel_requested, stop_requested`;
  return row ? { held: true, cancel: Boolean(row.cancel_requested), stop: Boolean(row.stop_requested) } : { held: false, cancel: false, stop: false };
}

export type Outcome = { status: "done" } | { status: "failed" | "cancelled"; error?: string } | { status: "retry"; error: string; delayMs: number };

/** Record how a claimed job ended. Only its lease holder can (a worker that lost the lease changes nothing). */
export async function settle(id: number, worker: string, outcome: Outcome, now = Date.now()): Promise<boolean> {
  const sql = db();
  const result =
    outcome.status === "retry"
      ? await sql`update jobs set status = 'queued', run_after = ${now + outcome.delayMs}, last_error = ${outcome.error.slice(0, 2000)},
          lease_owner = null, lease_until = null, updated_at = ${now}
          where id = ${id} and lease_owner = ${worker} and status = 'running'`
      : await sql`update jobs set status = ${outcome.status}, last_error = ${outcome.status === "done" ? null : (outcome.error ?? null)?.slice(0, 2000) ?? null},
          lease_owner = null, lease_until = null, finished_at = ${now}, updated_at = ${now}
          where id = ${id} and lease_owner = ${worker} and status = 'running'`;
  return result.count > 0;
}

/** Hand a running job back unfinished (its worker is shutting down): queued again at once, the attempt not counted. */
export async function release(id: number, worker: string, now = Date.now()): Promise<boolean> {
  const result = await db()`update jobs set status = 'queued', run_after = ${now}, attempts = greatest(attempts - 1, 0),
      lease_owner = null, lease_until = null, updated_at = ${now}
    where id = ${id} and lease_owner = ${worker} and status = 'running'`;
  if (result.count > 0) await db()`select pg_notify(${JOBS_CHANNEL}, 'released')`;
  return result.count > 0;
}

/** Wait between attempts: 30 s, 2 min, 8 min... up to 30 min. */
export const retryDelay = (attempts: number) => Math.min(30 * 60_000, 30_000 * 4 ** Math.max(0, attempts - 1));

/**
 * Ask a project's live jobs (of a kind, or one clip's export) to stop: queued ones are
 * cancelled now, running ones when their worker next renews its lease. Returns how many.
 */
export async function requestCancel(projectId: string, filter: { kind?: JobKind; clipId?: string } = {}, now = Date.now()): Promise<number> {
  const sql = db();
  const rows = await sql`
    update jobs set cancel_requested = true, updated_at = ${now},
      status = case when status = 'queued' then 'cancelled' else status end,
      finished_at = case when status = 'queued' then ${now} else finished_at end
    where project_id = ${projectId} and status in ${sql(ACTIVE)}
      ${filter.kind ? sql`and kind = ${filter.kind}` : sql``}
      ${filter.clipId ? sql`and clip_id = ${filter.clipId}` : sql``}
    returning id`;
  return rows.count;
}

/** Ask a project's recording (a capture, or a followed stream) to end now, keeping what was recorded. */
export async function requestStop(projectId: string, now = Date.now()): Promise<number> {
  const sql = db();
  const rows = await sql`update jobs set stop_requested = true, updated_at = ${now}
    where project_id = ${projectId} and kind in ('import', 'follow') and status in ${sql(ACTIVE)} returning id`;
  return rows.count;
}

/** The live jobs of some projects: which kinds, and which clips are exporting. */
export async function activeJobs(projectIds: string[], sql: Sql | Tx = db()): Promise<Map<string, { kinds: Set<JobKind>; clips: Set<string> }>> {
  const map = new Map<string, { kinds: Set<JobKind>; clips: Set<string> }>();
  if (projectIds.length === 0) return map;
  const rows = await sql<Row[]>`select project_id, kind, clip_id from jobs where project_id in ${sql(projectIds)} and status in ${sql(ACTIVE)}`;
  for (const r of rows) {
    const id = String(r.project_id);
    const entry = map.get(id) ?? { kinds: new Set<JobKind>(), clips: new Set<string>() };
    entry.kinds.add(r.kind as JobKind);
    if (r.clip_id) entry.clips.add(String(r.clip_id));
    map.set(id, entry);
  }
  return map;
}

/** Wait (up to `timeoutMs`) until none of a project's jobs (of a kind, or one clip's export) are running, e.g. before deleting its files. */
export async function waitForIdle(projectId: string, timeoutMs: number, filter: { kind?: JobKind; clipId?: string } = {}): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  const sql = db();
  for (;;) {
    const [row] = await sql<Row[]>`select count(*)::int as n from jobs where project_id = ${projectId} and status = 'running'
      ${filter.kind ? sql`and kind = ${filter.kind}` : sql``} ${filter.clipId ? sql`and clip_id = ${filter.clipId}` : sql``}`;
    if (Number(row?.n ?? 0) === 0) return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/** Forget finished jobs older than `days`. */
export async function pruneJobs(days = 30, now = Date.now()) {
  await db()`delete from jobs where status in ('done', 'failed', 'cancelled') and finished_at < ${now - days * 86_400_000}`;
}
