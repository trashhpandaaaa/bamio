import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { superadminEmails } from "@/lib/server/admin-roles";
import { db } from "@/lib/server/db";
import { queueEmail } from "@/lib/server/email";
import { reportMessage } from "@/lib/server/monitor";

/*
 * Alerts for the people who run Bamio. Every few minutes a worker looks at the queue; when
 * something needs a person, the superadmins (BAMIO_SUPERADMINS) get an email (through the email
 * outbox, once per problem per hour) and Sentry a warning:
 *   - jobs failing: BAMIO_ALERT_FAILED_JOBS (3) or more failed for good in the last hour;
 *   - the queue backing up: a job has waited longer than BAMIO_ALERT_WAIT_MIN (15) minutes;
 *   - an account deletion that keeps failing (3 tries), so a deleted user's plan may still charge;
 *   - campaign clips waiting for a look, and requests to run a campaign waiting for an answer
 *     (each once a day while any wait).
 */

export type Alert = { key: string; title: string; lines: string[]; path: string };

const HOUR = 3600_000;
const setting = (name: string, fallback: number) => Math.max(1, Number(process.env[name]) || fallback);
const minutes = (ms: number) => `${Math.round(ms / 60_000)} min`;

/** What needs a person now. Keys name the problem and the hour, so each goes out once an hour. */
export async function findAlerts(now = Date.now()): Promise<Alert[]> {
  const sql = db();
  const hour = Math.floor(now / HOUR);
  const alerts: Alert[] = [];

  const failedLimit = setting("BAMIO_ALERT_FAILED_JOBS", 3);
  const failed = await sql<{ id: number; kind: string; last_error: string | null }[]>`
    select id::int, kind, last_error from jobs where status = 'failed' and finished_at >= ${now - HOUR} order by id desc limit 50`;
  if (failed.length >= failedLimit) {
    alerts.push({
      key: `ops:jobs-failed:${hour}`,
      title: `${failed.length} jobs failed in the last hour`,
      lines: failed.slice(0, 8).map((j) => `${j.kind} #${j.id}: ${(j.last_error ?? "no message").slice(0, 300)}`),
      path: "/admin/jobs?view=failed",
    });
  }

  const waitLimit = setting("BAMIO_ALERT_WAIT_MIN", 15) * 60_000;
  const [waiting] = await sql<{ n: number; oldest: number | null }[]>`
    select count(*)::int as n, min(run_after)::float8 as oldest from jobs where status = 'queued' and run_after <= ${now}`;
  if (waiting?.oldest && now - waiting.oldest > waitLimit) {
    alerts.push({
      key: `ops:queue-waiting:${hour}`,
      title: `A job has waited ${minutes(now - waiting.oldest)} to start`,
      lines: [`${waiting.n} ${waiting.n === 1 ? "job is" : "jobs are"} waiting. Workers may be stopped, stuck or all busy.`],
      path: "/admin/jobs?view=active",
    });
  }

  const stuck = await sql<{ user_id: string; attempts: number; last_error: string | null }[]>`
    select user_id, attempts, last_error from account_deletions where status <> 'done' and attempts >= 3 limit 10`;
  if (stuck.length > 0) {
    alerts.push({
      key: `ops:deletions-failing:${hour}`,
      title: `${stuck.length} account ${stuck.length === 1 ? "deletion keeps" : "deletions keep"} failing`,
      lines: stuck.map((d) => `${d.user_id} (${d.attempts} tries): ${(d.last_error ?? "no message").slice(0, 300)}`),
      path: "/admin",
    });
  }

  const [clips] = await sql<{ n: number; campaigns: number }[]>`
    select count(*)::int as n, count(distinct c.campaign_id)::int as campaigns
    from campaign_clips c join campaigns g on g.id = c.campaign_id where c.status = 'pending' and g.status <> 'draft'`;
  if (clips && clips.n > 0) {
    alerts.push({
      // Once a day, not once an hour: nothing is broken, someone is waiting.
      key: `ops:clips-waiting:${Math.floor(now / (24 * HOUR))}`,
      title: `${clips.n} campaign ${clips.n === 1 ? "clip is" : "clips are"} waiting for a look`,
      lines: [`Clippers sent them to ${clips.campaigns === 1 ? "a campaign" : `${clips.campaigns} campaigns`}. A clip counts only once it’s approved: open each campaign in the admin panel.`],
      path: "/admin/campaigns",
    });
  }
  const [asked] = await sql<{ n: number; names: string | null }[]>`
    select count(*)::int as n, string_agg(name, ', ' order by id) as names from campaign_requests where status = 'pending'`;
  if (asked && asked.n > 0) {
    alerts.push({
      key: `ops:campaign-requests:${Math.floor(now / (24 * HOUR))}`,
      title: `${asked.n} ${asked.n === 1 ? "request" : "requests"} to run a campaign ${asked.n === 1 ? "is" : "are"} waiting`,
      lines: [`From: ${(asked.names ?? "").slice(0, 300)}. Look at who is promising the money, then make the campaign or decline it.`],
      path: "/admin/campaigns",
    });
  }
  return alerts;
}

/** The superadmins' Clerk user ids (their verified primary emails are in BAMIO_SUPERADMINS). */
async function superadminIds(): Promise<string[]> {
  const emails = superadminEmails();
  if (emails.length === 0) return [];
  const res = await (await clerkClient()).users.getUserList({ emailAddress: emails, limit: 20 });
  return res.data
    .filter((u) => u.primaryEmailAddress?.verification?.status === "verified" && emails.includes(u.primaryEmailAddress.emailAddress.toLowerCase()))
    .map((u) => u.id);
}

export type AlertDeps = { recipients: () => Promise<string[]>; queue: typeof queueEmail; report: typeof reportMessage };
const defaultDeps: AlertDeps = { recipients: superadminIds, queue: queueEmail, report: reportMessage };

/** Alerts told to Sentry by this process (when nobody could be emailed, the email outbox can't dedupe them). */
const reported = new Set<string>();

/** Email each alert to the superadmins and tell Sentry. An alert already sent this hour isn't sent again. */
export async function sendAlerts(alerts: Alert[], deps: AlertDeps = defaultDeps): Promise<number> {
  if (alerts.length === 0) return 0;
  const to = await deps.recipients();
  let sent = 0;
  for (const alert of alerts) {
    const fresh = (await Promise.all(to.map((userId) => deps.queue(userId, alert.key, { template: "ops-alert", title: alert.title, lines: alert.lines, path: alert.path })))).some(Boolean);
    if (fresh || (to.length === 0 && !reported.has(alert.key))) deps.report(alert.title, { lines: alert.lines, key: alert.key });
    reported.add(alert.key);
    if (fresh) sent++;
  }
  return sent;
}

export type Alerter = { stop: () => void };

/** Check every few minutes (BAMIO_ALERT_EVERY_MIN, 5). */
export function startAlerts(log: (m: string) => void = console.log): Alerter {
  let quietUntil = 0;
  const check = () =>
    void findAlerts()
      .then((alerts) => sendAlerts(alerts))
      .catch((err: unknown) => {
        if (Date.now() >= quietUntil) {
          log(`[bamio/alerts] couldn't check: ${err instanceof Error ? err.message : String(err)}`);
          quietUntil = Date.now() + HOUR;
        }
      });
  const timer = setInterval(check, setting("BAMIO_ALERT_EVERY_MIN", 5) * 60_000);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
