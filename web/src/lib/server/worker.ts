import "server-only";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { isAbortError } from "@/lib/server/bin";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { claim, heartbeat, JOBS_CHANNEL, pruneJobs, release, retryDelay, settle, type JobKind, type JobRow } from "@/lib/server/queue";

/*
 * A worker: claims jobs from the queue (queue.ts) and runs them. Several can run, in the web
 * server (BAMIO_WORKER, the default) or as their own processes (`npm run worker`), on one
 * machine or many. Each pool of job kinds has its own number of slots. While a job runs its
 * lease is renewed; a cancel request aborts it, a stop request ends a recording early. A job
 * that fails unexpectedly is tried again later, up to its attempts; one that fails for a
 * reason a retry won't fix (a 4xx HttpError), or takes too long, fails at once.
 */

export type JobContext = { job: JobRow; signal: AbortSignal; stopSignal: AbortSignal };

export type KindSpec = {
  run(job: JobRow, ctx: JobContext): Promise<void>;
  /** It failed for good: record that on the project. */
  failed?(job: JobRow, err: unknown): Promise<void>;
  /** It will be tried again after `delayMs`: say so on the project. */
  retrying?(job: JobRow, err: unknown, delayMs: number): Promise<void>;
  timeoutMs: number;
};

export type Pool = { name: string; kinds: JobKind[]; concurrency: number; perUserMax: number };

export type WorkerOptions = { id?: string; leaseMs?: number; heartbeatMs?: number; pollMs?: number; retryDelay?: (attempts: number) => number; log?: (message: string) => void };

export type Worker = { id: string; running(): number; stop(timeoutMs?: number): Promise<void> };

class GaveUp extends Error {}
class TookTooLong extends Error {}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function startWorker(specs: Record<JobKind, KindSpec>, pools: Pool[], opts: WorkerOptions = {}): Worker {
  const id = opts.id ?? `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const leaseMs = opts.leaseMs ?? 30_000;
  const heartbeatMs = opts.heartbeatMs ?? 10_000;
  const log = opts.log ?? ((m: string) => console.log(`[bamio/worker] ${m}`));
  const counts = pools.map(() => 0);
  const active = new Map<number, { controller: AbortController; done: Promise<void> }>();
  let stopping = false;
  // The database being down shows once a minute, not on every poll.
  let quietUntil = 0;

  async function runJob(job: JobRow, controller: AbortController) {
    const spec = specs[job.kind];
    const stopper = new AbortController();
    let lost = false;
    let cancelled = false;
    let timedOut = false;
    if (job.stopRequested) stopper.abort();
    const beat = setInterval(() => {
      void heartbeat(job.id, id, leaseMs).then(
        (hb) => {
          if (!hb.held) {
            lost = true;
            controller.abort();
          } else {
            if (hb.cancel) {
              cancelled = true;
              controller.abort();
            }
            if (hb.stop) stopper.abort();
          }
        },
        // The database is briefly unreachable: keep working, the lease outlives a missed beat.
        () => undefined,
      );
    }, heartbeatMs);
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, spec.timeoutMs);
    try {
      if (job.attempts > job.maxAttempts) throw new GaveUp(job.lastError ?? "It kept failing.");
      await spec.run(job, { job, signal: controller.signal, stopSignal: stopper.signal });
      if (!lost) await settle(job.id, id, { status: "done" });
    } catch (raw) {
      if (lost) return; // Another worker has it now.
      if (cancelled || job.cancelRequested) {
        await settle(job.id, id, { status: "cancelled" });
        return;
      }
      if (stopping && !timedOut) {
        // Shutting down: someone else picks it up straight away.
        await release(job.id, id);
        return;
      }
      const err = timedOut ? new TookTooLong("It took too long, so Bamio stopped it. Try again.") : raw;
      const permanent = err instanceof GaveUp || err instanceof TookTooLong || (err instanceof HttpError && err.status < 500) || isAbortError(err);
      if (!permanent && job.attempts < job.maxAttempts) {
        const delayMs = (opts.retryDelay ?? retryDelay)(job.attempts);
        log(`${job.kind} job ${job.id} failed (attempt ${job.attempts} of ${job.maxAttempts}), trying again in ${Math.round(delayMs / 1000)} s: ${message(err)}`);
        if (await settle(job.id, id, { status: "retry", error: message(err), delayMs })) await spec.retrying?.(job, err, delayMs).catch(() => undefined);
      } else {
        if (!(err instanceof HttpError)) log(`${job.kind} job ${job.id} failed: ${message(err)}`);
        if (await settle(job.id, id, { status: "failed", error: message(err) })) await spec.failed?.(job, err).catch((e: unknown) => log(`recording the failure failed: ${message(e)}`));
      }
    } finally {
      clearInterval(beat);
      clearTimeout(timer);
    }
  }

  // Claim until every pool's slots are full, or nothing is due. One pass at a time.
  let filling: Promise<void> | null = null;
  let again = false;
  async function fill() {
    for (const [i, pool] of pools.entries()) {
      while (!stopping && counts[i]! < pool.concurrency) {
        const job = await claim(id, pool.kinds, { leaseMs, perUserMax: pool.perUserMax }).catch((err: unknown) => {
          if (Date.now() >= quietUntil) {
            log(`can't claim jobs: ${message(err)}`);
            quietUntil = Date.now() + 60_000;
          }
          return null;
        });
        if (!job) break;
        counts[i]!++;
        const controller = new AbortController();
        const done = runJob(job, controller).finally(() => {
          counts[i]!--;
          active.delete(job.id);
          kick();
        });
        active.set(job.id, { controller, done });
      }
    }
  }
  function kick() {
    if (stopping) return;
    if (filling) {
      again = true;
      return;
    }
    filling = (async () => {
      do {
        again = false;
        await fill();
      } while (again && !stopping);
    })().finally(() => {
      filling = null;
    });
  }

  // Woken when a job is queued; a poll as a fallback (and for retries coming due).
  const listening = db()
    .listen(JOBS_CHANNEL, () => kick())
    .catch((err: unknown) => {
      log(`can't listen for new jobs (${message(err)}); polling only`);
      return null;
    });
  const poll = setInterval(kick, opts.pollMs ?? 3_000);
  const prune = setInterval(() => void pruneJobs().catch(() => undefined), 6 * 3600_000);
  poll.unref?.();
  prune.unref?.();
  kick();
  log(`${id} started: ${pools.map((p) => `${p.name} ×${p.concurrency}`).join(", ")}`);

  return {
    id,
    running: () => active.size,
    async stop(timeoutMs = 10_000) {
      stopping = true;
      clearInterval(poll);
      clearInterval(prune);
      await (await listening)?.unlisten().catch(() => undefined);
      // Running jobs are handed back (release) as they notice the abort.
      for (const task of active.values()) task.controller.abort();
      await Promise.race([Promise.allSettled([...active.values()].map((t) => t.done)), new Promise((r) => setTimeout(r, timeoutMs))]);
      await filling;
    },
  };
}
