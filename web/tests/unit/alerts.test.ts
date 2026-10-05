import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { findAlerts, sendAlerts, type AlertDeps } from "@/lib/server/alerts";
import { withContext } from "@/lib/server/context";
import { db } from "@/lib/server/db";
import { jsonLine } from "@/lib/server/monitor";
import { blankProject, createProject } from "@/lib/server/store";

/* Alerts for the people who run Bamio, and the JSON log lines. */

const USER = "user_alerts";
// Ten days ahead: other tests' jobs (made now) are outside every window.
const NOW = Date.now() + 10 * 86_400_000;
const MIN = 60_000;

async function project() {
  const p = blankProject({ title: "A", source: { kind: "upload", platform: "upload", title: "A", durationSec: 0 }, findClips: false, clipLength: "short", job: { status: "ready", message: "Ready" } });
  await createProject(USER, p);
  return p.id;
}

async function job(projectId: string, kind: string, status: string, at: number, error?: string) {
  await db()`insert into jobs (kind, user_id, project_id, status, last_error, run_after, created_at, updated_at, finished_at)
    values (${kind}, ${USER}, ${projectId}, ${status}, ${error ?? null}, ${at}, ${at}, ${at}, ${status === "failed" ? at : null})`;
}

async function clean() {
  await db()`delete from projects where user_id = ${USER}`;
  await db()`delete from account_deletions where user_id = ${USER}`;
}

describe("alerts", () => {
  beforeEach(clean);
  afterAll(clean);

  it("find jobs failing, the queue backing up, and deletions that keep failing", async () => {
    expect(await findAlerts(NOW)).toEqual([]);
    const ids = await Promise.all([project(), project(), project(), project()]);
    await job(ids[0]!, "import", "failed", NOW - 10 * MIN, "ffmpeg crashed");
    await job(ids[1]!, "export", "failed", NOW - 20 * MIN, "render failed");
    expect(await findAlerts(NOW)).toEqual([]); // two isn't three
    await job(ids[2]!, "import", "failed", NOW - 30 * MIN, "download failed");
    await job(ids[3]!, "import", "failed", NOW - 2 * 60 * MIN, "old news"); // outside the hour
    await job(ids[3]!, "analyze", "queued", NOW - 20 * MIN);
    await db()`insert into account_deletions (user_id, reason, attempts, run_after, requested_at, last_error) values (${USER}, 'self', 3, ${NOW}, ${NOW}, 'Stripe is down')`;

    const alerts = await findAlerts(NOW);
    const hour = Math.floor(NOW / 3600_000);
    expect(alerts.map((a) => a.key)).toEqual([`ops:jobs-failed:${hour}`, `ops:queue-waiting:${hour}`, `ops:deletions-failing:${hour}`]);
    expect(alerts[0]).toMatchObject({ title: "3 jobs failed in the last hour", path: "/admin/jobs?view=failed" });
    expect(alerts[0]!.lines.join(" ")).toContain("ffmpeg crashed");
    expect(alerts[0]!.lines.join(" ")).not.toContain("old news");
    expect(alerts[1]!.title).toBe("A job has waited 20 min to start");
    expect(alerts[2]!.lines[0]).toContain("Stripe is down");
  });

  it("email each superadmin once an hour per problem, and tell Sentry about new ones", async () => {
    const queued = new Set<string>();
    const reports: string[] = [];
    const deps: AlertDeps = {
      recipients: async () => ["user_boss"],
      queue: async (userId, key) => {
        if (queued.has(`${userId}:${key}`)) return false;
        queued.add(`${userId}:${key}`);
        return true;
      },
      report: (title) => void reports.push(title),
    };
    const alert = { key: "ops:test:1", title: "Something broke", lines: ["details"], path: "/admin" };
    expect(await sendAlerts([alert], deps)).toBe(1);
    expect(await sendAlerts([alert], deps)).toBe(0); // the same hour: nothing new
    expect(reports).toEqual(["Something broke"]);
    // Nobody to email: Sentry hears it once.
    const nobody = { ...deps, recipients: async () => [] };
    await sendAlerts([{ ...alert, key: "ops:test:2" }], nobody);
    await sendAlerts([{ ...alert, key: "ops:test:2" }], nobody);
    expect(reports).toEqual(["Something broke", "Something broke"]);
  });
});

describe("log lines", () => {
  it("are one JSON object with the message, the error, the data and the request or job", () => {
    const line = withContext({ reqId: "ray-1", userId: "user_x" }, () => JSON.parse(jsonLine("error", ["[bamio] export failed", new Error("boom"), { clip: "c1" }])));
    expect(line).toMatchObject({ level: "error", msg: "[bamio] export failed", reqId: "ray-1", userId: "user_x", err: { name: "Error", message: "boom" }, data: { clip: "c1" } });
    expect(typeof line.time).toBe("string");
    const job = withContext({ jobId: 7, kind: "import" }, () => JSON.parse(jsonLine("info", ["done", 3])));
    expect(job).toMatchObject({ msg: "done 3", jobId: 7, kind: "import" });
    expect(job).not.toHaveProperty("reqId");
  });
});
