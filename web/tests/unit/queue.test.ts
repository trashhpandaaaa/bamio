import { describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { activeJobs, claim, enqueue, heartbeat, requestCancel, requestStop, retryDelay, settle } from "@/lib/server/queue";
import { blankProject, createProject } from "@/lib/server/store";

/* The Postgres job queue: what several workers can rely on. */

const LEASE = { leaseMs: 30_000, perUserMax: 5 };

async function project(userId: string) {
  const p = blankProject({
    title: "Q",
    source: { kind: "upload", platform: "upload", title: "Q", durationSec: 0 },
    findClips: true,
    clipLength: "short",
    job: { status: "queued", message: "Waiting" },
  });
  await createProject(userId, p);
  return p.id;
}

/** Every job but the worker tests' (they use only "retranscribe" jobs, and run side by side with these). */
const clear = () => db()`delete from jobs where kind <> 'retranscribe'`;

describe("job queue", () => {
  it("keeps one live job per project and kind (and clip), and queues again once it's done", async () => {
    await clear();
    const p = await project("user_q1");
    const first = await enqueue({ kind: "import", userId: "user_q1", projectId: p });
    const again = await enqueue({ kind: "import", userId: "user_q1", projectId: p });
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: first.id, created: false });
    const a = await enqueue({ kind: "export", userId: "user_q1", projectId: p, clipId: "c1" });
    const b = await enqueue({ kind: "export", userId: "user_q1", projectId: p, clipId: "c2" });
    expect(a.id).not.toBe(b.id);
    const job = await claim("w1", ["import"], LEASE);
    expect(job?.id).toBe(first.id);
    await settle(job!.id, "w1", { status: "done" });
    expect((await enqueue({ kind: "import", userId: "user_q1", projectId: p })).created).toBe(true);
  });

  it("hands out the highest priority first, then the oldest, and never one job twice", async () => {
    await clear();
    const ids: number[] = [];
    for (const priority of [0, 1, 0, 1, 0]) ids.push((await enqueue({ kind: "analyze", userId: `user_p${ids.length}`, projectId: await project(`user_p${ids.length}`), priority })).id);
    // Five workers at once, for five jobs: each gets a different one.
    const claimed = await Promise.all(Array.from({ length: 7 }, (_, i) => claim(`w${i}`, ["analyze"], LEASE)));
    const got = claimed.filter(Boolean).map((j) => j!.id);
    expect(new Set(got).size).toBe(5);
    expect(claimed.filter((j) => j === null)).toHaveLength(2);
    // Order, claimed one at a time.
    await clear();
    const order: number[] = [];
    for (const [i, priority] of [0, 1, 0, 1].entries()) order.push((await enqueue({ kind: "analyze", userId: `user_o${i}`, projectId: await project(`user_o${i}`), priority })).id);
    const sequence = [];
    for (let i = 0; i < 4; i++) sequence.push((await claim("w", ["analyze"], LEASE))!.id);
    expect(sequence).toEqual([order[1], order[3], order[0], order[2]]);
  });

  it("keeps one user from taking every slot", async () => {
    await clear();
    const busy = "user_busy";
    for (let i = 0; i < 3; i++) await enqueue({ kind: "export", userId: busy, projectId: await project(busy), clipId: `c${i}` });
    const other = await enqueue({ kind: "export", userId: "user_other1", projectId: await project("user_other1"), clipId: "x" });
    const limits = { leaseMs: 30_000, perUserMax: 2 };
    const first = await claim("w", ["export"], limits);
    const second = await claim("w", ["export"], limits);
    const third = await claim("w", ["export"], limits);
    expect([first, second].map((j) => j!.userId)).toEqual([busy, busy]);
    expect(third!.id).toBe(other.id); // the busy user's third waits
    expect(await claim("w", ["export"], limits)).toBeNull();
  });

  it("gives a job whose worker stopped to another worker, which resumes it", async () => {
    await clear();
    const p = await project("user_lease");
    await enqueue({ kind: "follow", userId: "user_lease", projectId: p });
    const t0 = Date.now();
    const job = await claim("dead-worker", ["follow"], { leaseMs: 1_000, perUserMax: 5 }, t0);
    expect(job).toMatchObject({ attempts: 1, leaseOwner: "dead-worker" });
    expect(await claim("w2", ["follow"], LEASE, t0 + 500)).toBeNull(); // still leased
    const resumed = await claim("w2", ["follow"], LEASE, t0 + 2_000);
    expect(resumed).toMatchObject({ id: job!.id, attempts: 2, leaseOwner: "w2" });
    // The first worker has lost it: its heartbeat says so, and it can't settle the job.
    expect(await heartbeat(job!.id, "dead-worker", 1_000)).toMatchObject({ held: false });
    expect(await settle(job!.id, "dead-worker", { status: "done" })).toBe(false);
    expect(await heartbeat(job!.id, "w2", 30_000)).toEqual({ held: true, cancel: false, stop: false });
  });

  it("retries later, after a growing wait", async () => {
    await clear();
    expect([1, 2, 3, 9].map(retryDelay)).toEqual([30_000, 120_000, 480_000, 1_800_000]);
    const p = await project("user_retry");
    await enqueue({ kind: "import", userId: "user_retry", projectId: p });
    const t0 = Date.now();
    const job = await claim("w", ["import"], LEASE, t0);
    await settle(job!.id, "w", { status: "retry", error: "network hiccup", delayMs: 30_000 }, t0);
    expect(await claim("w", ["import"], LEASE, t0 + 10_000)).toBeNull();
    expect(await claim("w", ["import"], LEASE, t0 + 31_000)).toMatchObject({ id: job!.id, attempts: 2, lastError: "network hiccup" });
  });

  it("cancels queued jobs at once and running ones through their heartbeat, and passes on stop requests", async () => {
    await clear();
    const p = await project("user_cancel");
    await enqueue({ kind: "follow", userId: "user_cancel", projectId: p });
    const running = await claim("w", ["follow"], LEASE);
    await enqueue({ kind: "export", userId: "user_cancel", projectId: p, clipId: "c" });
    expect((await activeJobs([p])).get(p)).toEqual({ kinds: new Set(["follow", "export"]), clips: new Set(["c"]) });

    expect(await requestStop(p)).toBe(1);
    expect(await heartbeat(running!.id, "w", 30_000)).toEqual({ held: true, cancel: false, stop: true });
    expect(await requestCancel(p)).toBe(2);
    expect(await heartbeat(running!.id, "w", 30_000)).toMatchObject({ held: true, cancel: true });
    expect((await activeJobs([p])).get(p)?.kinds).toEqual(new Set(["follow"])); // the export was only queued: gone
    await settle(running!.id, "w", { status: "cancelled" });
    expect((await activeJobs([p])).get(p)).toBeUndefined();
  });

  it("goes with its project", async () => {
    await clear();
    const p = await project("user_gone");
    await enqueue({ kind: "import", userId: "user_gone", projectId: p });
    await db()`delete from projects where id = ${p}`;
    const [row] = await db()<{ n: number }[]>`select count(*)::int as n from jobs where project_id = ${p}`;
    expect(row?.n).toBe(0);
  });
});
