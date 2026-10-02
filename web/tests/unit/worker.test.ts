import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { claim, enqueue, requestCancel, type JobKind, type JobRow } from "@/lib/server/queue";
import { blankProject, createProject } from "@/lib/server/store";
import { startWorker, type KindSpec, type Pool, type Worker } from "@/lib/server/worker";

/*
 * The worker loop, with stand-in jobs: what happens around a job, not the job itself. Uses only
 * "retranscribe" jobs, so it never takes the queue tests' jobs (test files run side by side).
 */

const FAST = { leaseMs: 600, heartbeatMs: 50, pollMs: 50, retryDelay: () => 0, log: () => undefined };
const KIND: JobKind = "retranscribe";
const POOL: Pool[] = [{ name: "test", kinds: [KIND], concurrency: 2, perUserMax: 5 }];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (check: () => Promise<boolean> | boolean, ms = 8_000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await sleep(25);
  }
};
const statusOf = async (id: number) => (await db()<{ status: string; attempts: number }[]>`select status, attempts from jobs where id = ${id}`)[0];

let worker: Worker | null = null;
afterEach(async () => {
  await worker?.stop(2_000);
  worker = null;
  await db()`delete from jobs where kind = ${KIND}`;
});

async function job(userId = "user_w", kind: JobKind = KIND) {
  const p = blankProject({
    title: "W",
    source: { kind: "upload", platform: "upload", title: "W", durationSec: 0 },
    findClips: true,
    clipLength: "short",
    job: { status: "queued", message: "Waiting" },
  });
  await createProject(userId, p);
  return (await enqueue({ kind, userId, projectId: p.id, maxAttempts: 3 })).id;
}

function specs(run: KindSpec["run"], extra: Partial<KindSpec> = {}): Record<JobKind, KindSpec> {
  const spec: KindSpec = { run, timeoutMs: 10_000, ...extra };
  return { import: spec, analyze: spec, retranscribe: spec, export: spec, follow: spec, "finish-follow": spec };
}

describe("worker", { timeout: 20_000 }, () => {
  it("runs queued jobs, no more at once than its slots", async () => {
    let now = 0;
    let most = 0;
    const ids = await Promise.all([1, 2, 3, 4].map((i) => job(`user_w${i}`)));
    worker = startWorker(
      specs(async () => {
        most = Math.max(most, ++now);
        await sleep(150);
        now--;
      }),
      POOL,
      FAST,
    );
    await until(async () => (await Promise.all(ids.map(statusOf))).every((s) => s?.status === "done"));
    expect(most).toBe(2);
  });

  it("tries again after an unexpected failure, and fails for good on a permanent one", async () => {
    const flaky = await job("user_flaky");
    const broken = await job("user_broken");
    const failed: number[] = [];
    const retried: number[] = [];
    worker = startWorker(
      specs(
        async (j: JobRow) => {
          if (j.id === broken) throw new HttpError(422, "no_video", "That file has no video in it.");
          if (j.attempts === 1) throw new Error("connection reset");
        },
        { failed: async (j) => void failed.push(j.id), retrying: async (j) => void retried.push(j.id) },
      ),
      POOL,
      FAST,
    );
    await until(async () => (await statusOf(flaky))?.status === "done" && (await statusOf(broken))?.status === "failed");
    expect(await statusOf(flaky)).toMatchObject({ attempts: 2 });
    expect(retried).toEqual([flaky]);
    expect(failed).toEqual([broken]);
  });

  it("stops a job that takes too long", async () => {
    const id = await job("user_slow");
    let reason: unknown;
    worker = startWorker(specs((_j, { signal }) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))), { timeoutMs: 200, failed: async (_j, err) => void (reason = err) }), POOL, FAST);
    await until(async () => (await statusOf(id))?.status === "failed");
    expect(String(reason)).toContain("took too long");
  });

  it("passes on cancel and stop requests while a job runs", async () => {
    const cancelMe = await job("user_c1");
    const stopMe = await job("user_c2");
    const projectOf = async (id: number) => (await db()<{ project_id: string }[]>`select project_id from jobs where id = ${id}`)[0]!.project_id;
    let stopped = false;
    let failedCalled = false;
    worker = startWorker(
      specs(
        (j, { signal, stopSignal }) =>
          new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(new Error("aborted")));
            // A recording asked to stop: ends early, and the job completes normally.
            stopSignal.addEventListener("abort", () => {
              if (j.id === stopMe) {
                stopped = true;
                resolve();
              }
            });
          }),
        { failed: async () => void (failedCalled = true) },
      ),
      POOL,
      FAST,
    );
    await until(async () => (await statusOf(cancelMe))?.status === "running" && (await statusOf(stopMe))?.status === "running");
    await requestCancel(await projectOf(cancelMe));
    // (requestStop asks recording jobs only; the queue tests cover that. Here: the flag reaching the job.)
    await db()`update jobs set stop_requested = true where id = ${stopMe}`;
    await until(async () => (await statusOf(cancelMe))?.status === "cancelled" && (await statusOf(stopMe))?.status === "done");
    expect(stopped).toBe(true);
    expect(failedCalled).toBe(false);
  });

  it("resumes the job of a worker that stopped renewing its lease", async () => {
    const id = await job("user_crash");
    // A worker claims it and dies.
    await claim("crashed", [KIND], { leaseMs: 300, perUserMax: 5 });
    const runs: number[] = [];
    worker = startWorker(specs(async (j) => void runs.push(j.attempts)), POOL, FAST);
    await until(async () => (await statusOf(id))?.status === "done");
    expect(runs).toEqual([2]);
  });

  it("hands its jobs back when it shuts down, without spending an attempt", async () => {
    const id = await job("user_shutdown");
    worker = startWorker(specs((_j, { signal }) => new Promise((_r, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))), POOL, FAST);
    await until(async () => (await statusOf(id))?.status === "running");
    await worker.stop(2_000);
    worker = null;
    expect(await statusOf(id)).toEqual({ status: "queued", attempts: 0 });
  });
});
