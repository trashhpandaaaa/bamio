import "server-only";
import { statfs } from "node:fs/promises";
import { clerkClient } from "@clerk/nextjs/server";
import type postgres from "postgres";
import { notFound } from "next/navigation";
import { ENTITLED_STATUSES, INTERVALS, PLAN_IDS, PLANS, type Interval, type PlanId } from "@/lib/billing/plans";
import { db } from "@/lib/server/db";
import type { JobKind } from "@/lib/server/queue";
import { HttpError, userRoute } from "@/lib/server/http";
import { storage } from "@/lib/server/storage";
import { dataRoot, workRoot } from "@/lib/server/store";

/*
 * The admin panel's access and data. Two roles: superadmins, named on the server
 * (BAMIO_SUPERADMINS: email addresses, verified in Clerk), and admins, which superadmins add
 * and remove from the panel (the admins table). Admins see everything and can retry or cancel
 * jobs; only superadmins give or take back plans and manage admins. Every change made from the
 * panel is logged (admin_actions). Someone who isn't an admin gets a 404: the panel isn't there.
 */

export type AdminRole = "superadmin" | "admin";
export type Admin = { userId: string; email: string; role: AdminRole };

const emailList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** The superadmins' email addresses (BAMIO_SUPERADMINS). */
export const superadminEmails = () => emailList(process.env.BAMIO_SUPERADMINS);

type Cached = { at: number; admin: Admin | null };
const roles: Map<string, Cached> = ((globalThis as { __bamioAdmins?: Map<string, Cached> }).__bamioAdmins ??= new Map());

/** A user's verified primary email address, from Clerk, or null. */
async function verifiedEmail(userId: string): Promise<string | null> {
  const user = await (await clerkClient()).users.getUser(userId);
  const primary = user.primaryEmailAddress;
  return primary && primary.verification?.status === "verified" ? primary.emailAddress.toLowerCase() : null;
}

/** The user's admin role, or null. Remembered for a minute (Clerk is asked once a minute at most). */
export async function adminOf(userId: string): Promise<Admin | null> {
  const hit = roles.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.admin;
  let admin: Admin | null = null;
  const email = await verifiedEmail(userId).catch(() => null);
  if (email && superadminEmails().includes(email)) admin = { userId, email, role: "superadmin" };
  else {
    const [row] = await db()<{ email: string }[]>`select email from admins where user_id = ${userId}`;
    if (row) admin = { userId, email: email ?? row.email, role: "admin" };
  }
  roles.set(userId, { at: Date.now(), admin });
  return admin;
}

/** Forget cached roles (after admins change). */
export const forgetAdminRoles = () => roles.clear();

/**
 * For admin pages: the signed-in admin, or the page doesn't exist (signed out too: nothing points
 * outsiders to the panel, not robots.txt, not a sign-in redirect). Every admin page calls it.
 */
export async function requireAdmin(role: AdminRole = "admin"): Promise<Admin> {
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  if (!userId) notFound();
  const admin = await adminOf(userId);
  if (!admin || (role === "superadmin" && admin.role !== "superadmin")) notFound();
  return admin;
}

/** An API route for admins (or only superadmins): signed in, same site, rate limited, then the role. Others get a 404. */
export function adminRoute<P extends Record<string, string> = Record<string, string>>(
  run: (req: Request, ctx: { admin: Admin; params: P }) => Promise<Response>,
  opts: { role?: AdminRole } = {},
) {
  return userRoute<P>(
    async (req, { userId, params }) => {
      const admin = await adminOf(userId);
      if (!admin || (opts.role === "superadmin" && admin.role !== "superadmin")) throw new HttpError(404, "not_found", "Not found.");
      return run(req, { admin, params });
    },
    { rate: { bucket: "admin", limit: 300, windowMs: 60_000 } },
  );
}

/** Note a change made from the panel. */
export async function logAdminAction(admin: Admin, action: string, target: string | null, details: Record<string, unknown> = {}) {
  await db()`insert into admin_actions (admin_user_id, admin_email, action, target, details, at)
    values (${admin.userId}, ${admin.email}, ${action}, ${target}, ${db().json(JSON.parse(JSON.stringify(details)))}, ${Date.now()})`;
}

/* ------------------------------ Users (Clerk) ------------------------------ */

export type UserSummary = { id: string; email: string | null; name: string | null; imageUrl: string | null; createdAt: number; lastActiveAt: number | null };

const summary = (u: Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["getUser"]>>): UserSummary => ({
  id: u.id,
  email: u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null,
  name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.username || null,
  imageUrl: u.imageUrl || null,
  createdAt: u.createdAt,
  lastActiveAt: u.lastActiveAt ?? u.lastSignInAt ?? null,
});

/** Users by email or name (newest first), a page at a time, with the total that match. */
export async function searchUsers(query: string, page: number, perPage = 25): Promise<{ users: UserSummary[]; total: number }> {
  const res = await (await clerkClient()).users.getUserList({ query: query || undefined, limit: perPage, offset: page * perPage, orderBy: "-created_at" });
  return { users: res.data.map(summary), total: res.totalCount };
}

/** These users' summaries, by id (for tables of jobs, grants, referrals). */
export async function usersById(ids: string[]): Promise<Map<string, UserSummary>> {
  const unique = [...new Set(ids)].filter(Boolean);
  const out = new Map<string, UserSummary>();
  for (let i = 0; i < unique.length; i += 100) {
    const res = await (await clerkClient()).users.getUserList({ userId: unique.slice(i, i + 100), limit: 100 }).catch(() => null);
    for (const u of res?.data ?? []) out.set(u.id, summary(u));
  }
  return out;
}

export async function userById(id: string): Promise<UserSummary | null> {
  return (await clerkClient()).users.getUser(id).then(summary, () => null);
}

/** The user with this email address (any of theirs), or null. */
export async function userByEmail(email: string): Promise<UserSummary | null> {
  const res = await (await clerkClient()).users.getUserList({ emailAddress: [email.trim().toLowerCase()], limit: 1 });
  return res.data[0] ? summary(res.data[0]) : null;
}

/* ------------------------------ Overview ------------------------------ */

const DAY = 86_400_000;
const monthStart = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
const todayStart = (now = new Date()) => Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

export type PlanCounts = { plan: PlanId; interval: Interval; active: number; pastDue: number; ending: number }[];

/** Working subscriptions by plan and billing period, from the billing records (kept current by Stripe's webhooks). */
export async function planCounts(): Promise<PlanCounts> {
  const rows = await db()<{ plan: string; interval: string; status: string; cancel_at: number | null }[]>`
    select data->'subscription'->>'plan' as plan, data->'subscription'->>'interval' as interval, data->'subscription'->>'status' as status,
           (data->'subscription'->>'cancelAt')::float8 as cancel_at
    from billing_accounts where data ? 'subscription'`;
  const now = Date.now();
  return PLAN_IDS.flatMap((plan) =>
    INTERVALS.map((interval) => {
      const mine = rows.filter((r) => r.plan === plan && r.interval === interval && ENTITLED_STATUSES.has(r.status) && (r.cancel_at === null || r.cancel_at > now));
      return { plan, interval, active: mine.length, pastDue: mine.filter((r) => r.status === "past_due").length, ending: mine.filter((r) => r.cancel_at !== null).length };
    }),
  );
}

/** Monthly revenue at list prices, from the working plans (3-month plans count a third of their price). Promo codes aren't taken off. */
export const listPriceMrr = (counts: PlanCounts) => counts.reduce((sum, c) => sum + c.active * (c.interval === "month" ? PLANS[c.plan].price.month : PLANS[c.plan].price.quarter / 3), 0);

export type Overview = {
  users: { total: number; new7d: number } | null;
  plans: PlanCounts;
  grants: number;
  projects: { total: number; today: number; week: number };
  minutes: { today: number; month: number };
  jobs: { queued: number; running: number; failed24h: number; oldestWaitingSec: number };
  emails: { sent24h: number; failed24h: number };
  disk: { path: string; freeBytes: number; totalBytes: number } | null;
  storage: string;
};

export async function overview(): Promise<Overview> {
  const sql = db();
  const now = Date.now();
  const [users, plans, [grants], [projects], [minutes], [jobs], [emails], disk] = await Promise.all([
    (async () => {
      const clerk = await clerkClient();
      const total = await clerk.users.getCount();
      const recent = await clerk.users.getUserList({ orderBy: "-created_at", limit: 100 });
      return { total, new7d: recent.data.filter((u) => u.createdAt >= now - 7 * DAY).length };
    })().catch(() => null),
    planCounts(),
    sql<{ n: number }[]>`select count(*)::int as n from plan_grants`,
    sql<{ total: number; today: number; week: number }[]>`
      select count(*)::int as total, count(*) filter (where created_at >= ${todayStart()})::int as today, count(*) filter (where created_at >= ${now - 7 * DAY})::int as week from projects`,
    sql<{ today: number; month: number }[]>`
      select coalesce(sum(sec) filter (where at >= ${todayStart()}), 0)::float8 / 60 as today, coalesce(sum(sec) filter (where at >= ${monthStart()}), 0)::float8 / 60 as month from usage_entries`,
    sql<{ queued: number; running: number; failed: number; oldest: number | null }[]>`
      select count(*) filter (where status = 'queued' and run_after <= ${now})::int as queued,
             count(*) filter (where status = 'running')::int as running,
             count(*) filter (where status = 'failed' and finished_at >= ${now - DAY})::int as failed,
             min(run_after) filter (where status = 'queued' and run_after <= ${now})::float8 as oldest
      from jobs`,
    sql<{ sent: number; failed: number }[]>`
      select count(*) filter (where status = 'sent' and updated_at >= ${now - DAY})::int as sent,
             count(*) filter (where status = 'failed' and updated_at >= ${now - DAY})::int as failed from emails`,
    (async () => {
      const path = storage().localPath ? dataRoot() : workRoot();
      const s = await statfs(path);
      return { path, freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize };
    })().catch(() => null),
  ]);
  return {
    users,
    plans,
    grants: grants?.n ?? 0,
    projects: projects ?? { total: 0, today: 0, week: 0 },
    minutes: { today: Math.round(minutes?.today ?? 0), month: Math.round(minutes?.month ?? 0) },
    jobs: { queued: jobs?.queued ?? 0, running: jobs?.running ?? 0, failed24h: jobs?.failed ?? 0, oldestWaitingSec: jobs?.oldest ? Math.round((now - jobs.oldest) / 1000) : 0 },
    emails: { sent24h: emails?.sent ?? 0, failed24h: emails?.failed ?? 0 },
    disk,
    storage: storage().name,
  };
}

/* ------------------------------ A user ------------------------------ */

export type UserRow = UserSummary & { plan: PlanId | null; status: string | null; granted: PlanId | null; projects: number; minutesMonth: number };

/** Plan, free plan, projects and this month's minutes for each user. */
export async function userRows(users: UserSummary[]): Promise<UserRow[]> {
  const ids = users.map((u) => u.id);
  if (ids.length === 0) return [];
  const sql = db();
  const [billing, grants, projects, usage] = await Promise.all([
    sql<{ user_id: string; plan: string | null; status: string | null }[]>`
      select user_id, data->'subscription'->>'plan' as plan, data->'subscription'->>'status' as status from billing_accounts where user_id in ${sql(ids)}`,
    sql<{ user_id: string; plan: string }[]>`select user_id, plan from plan_grants where user_id in ${sql(ids)}`,
    sql<{ user_id: string; n: number }[]>`select user_id, count(*)::int as n from projects where user_id in ${sql(ids)} group by user_id`,
    sql<{ user_id: string; min: number }[]>`
      select user_id, sum(sec)::float8 / 60 as min from usage_entries where user_id in ${sql(ids)} and at >= ${monthStart()} group by user_id`,
  ]);
  return users.map((u) => {
    const b = billing.find((r) => r.user_id === u.id);
    return {
      ...u,
      plan: (b?.plan as PlanId | undefined) ?? null,
      status: b?.status ?? null,
      granted: (grants.find((g) => g.user_id === u.id)?.plan as PlanId | undefined) ?? null,
      projects: projects.find((p) => p.user_id === u.id)?.n ?? 0,
      minutesMonth: Math.round(usage.find((m) => m.user_id === u.id)?.min ?? 0),
    };
  });
}

export type AdminProject = {
  id: string;
  title: string;
  createdAt: number;
  sourceKind: string;
  url: string | null;
  live: boolean;
  durationSec: number;
  status: string;
  error: string | null;
  clips: number;
  exports: number;
};

/** The user's projects, newest first (no media: what they're called, how they did). */
export async function userProjects(userId: string): Promise<AdminProject[]> {
  const rows = await db()<{ id: string; created_at: number; data: Record<string, unknown> }[]>`
    select id, created_at::float8 as created_at, data from projects where user_id = ${userId} order by created_at desc limit 200`;
  return rows.map((r) => {
    const d = r.data as {
      title?: string;
      source?: { kind?: string; url?: string; live?: unknown; durationSec?: number };
      job?: { status?: string; error?: string };
      clips?: { export?: { status?: string } }[];
    };
    return {
      id: r.id,
      title: d.title ?? "Untitled",
      createdAt: r.created_at,
      sourceKind: d.source?.kind ?? "?",
      url: d.source?.url ?? null,
      live: Boolean(d.source?.live),
      durationSec: d.source?.durationSec ?? 0,
      status: d.job?.status ?? "?",
      error: d.job?.error ?? null,
      clips: d.clips?.length ?? 0,
      exports: d.clips?.filter((c) => c.export?.status === "done").length ?? 0,
    };
  });
}

/** The user's free plan, their referral link's results and their latest emails. */
export async function userExtras(userId: string) {
  const sql = db();
  const [[grant], [referrals], [referredBy], emails] = await Promise.all([
    sql<{ plan: PlanId; created_at: number }[]>`select plan, created_at::float8 as created_at from plan_grants where user_id = ${userId}`,
    sql<{ pending: number; rewarded: number; cents: number }[]>`
      select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status <> 'pending')::int as rewarded,
             coalesce(sum(reward_cents), 0)::int as cents from referrals where referrer_user_id = ${userId}`,
    sql<{ referrer_user_id: string; status: string }[]>`select referrer_user_id, status from referrals where referred_user_id = ${userId}`,
    sql<{ template: string; status: string; subject: string | null; updated_at: number; last_error: string | null }[]>`
      select template, status, subject, updated_at::float8 as updated_at, last_error from emails where user_id = ${userId} order by id desc limit 10`,
  ]);
  return { grant: grant ?? null, referrals: referrals ?? { pending: 0, rewarded: 0, cents: 0 }, referredBy: referredBy ?? null, emails };
}

/** Give a user a plan for free (or another one), or take it back (`plan` null). */
export async function setPlanGrant(admin: Admin, userId: string, email: string | null, plan: PlanId | null) {
  if (plan) {
    await db()`insert into plan_grants (user_id, plan, note, created_at) values (${userId}, ${plan}, ${email ?? "given from the admin panel"}, ${Date.now()})
      on conflict (user_id) do update set plan = excluded.plan, note = excluded.note`;
  } else {
    await db()`delete from plan_grants where user_id = ${userId}`;
  }
  await logAdminAction(admin, plan ? "plan.grant" : "plan.revoke", userId, { email, plan });
}

/* ------------------------------ Jobs ------------------------------ */

export type JobView = "active" | "failed" | "recent";

export type AdminJob = {
  id: number;
  kind: JobKind;
  status: string;
  userId: string;
  projectId: string;
  projectTitle: string | null;
  clipId: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
  finishedAt: number | null;
  /** The newest job of its kind for its project (and clip): the one a retry would replace. */
  latest: boolean;
};

export async function jobList(view: JobView): Promise<AdminJob[]> {
  const sql = db();
  const where =
    view === "active"
      ? sql`j.status in ('queued', 'running')`
      : view === "failed"
        ? sql`j.status = 'failed' and j.finished_at >= ${Date.now() - 7 * DAY}`
        : sql`true`;
  return jobRows(where);
}

export async function jobById(id: number): Promise<AdminJob | null> {
  const [job] = await jobRows(db()`j.id = ${id}`);
  return job ?? null;
}

/** A user’s jobs, newest first. */
export const userJobs = (userId: string) => jobRows(db()`j.user_id = ${userId}`);

async function jobRows(where: postgres.PendingQuery<postgres.Row[]>): Promise<AdminJob[]> {
  const sql = db();
  const rows = await sql<Record<string, unknown>[]>`
    select j.id, j.kind, j.status, j.user_id, j.project_id, p.data->>'title' as title, j.clip_id, j.attempts, j.max_attempts, j.last_error,
           j.created_at::float8 as created_at, j.updated_at::float8 as updated_at, j.finished_at::float8 as finished_at,
           not exists (select 1 from jobs n where n.project_id = j.project_id and n.kind = j.kind and coalesce(n.clip_id, '') = coalesce(j.clip_id, '') and n.id > j.id) as latest
    from jobs j left join projects p on p.id = j.project_id
    where ${where}
    order by j.id desc limit 150`;
  return rows.map((r) => ({
    id: Number(r.id),
    kind: r.kind as JobKind,
    status: String(r.status),
    userId: String(r.user_id),
    projectId: String(r.project_id),
    projectTitle: (r.title as string | null) ?? null,
    clipId: (r.clip_id as string | null) ?? null,
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    lastError: (r.last_error as string | null) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    finishedAt: r.finished_at === null ? null : Number(r.finished_at),
    latest: Boolean(r.latest),
  }));
}

/* ------------------------------ Money ------------------------------ */

export async function grantList(): Promise<{ userId: string; plan: PlanId; note: string | null; createdAt: number }[]> {
  const rows = await db()<{ user_id: string; plan: PlanId; note: string | null; created_at: number }[]>`
    select user_id, plan, note, created_at::float8 as created_at from plan_grants order by created_at desc`;
  return rows.map((r) => ({ userId: r.user_id, plan: r.plan, note: r.note, createdAt: r.created_at }));
}

export async function referralTotals() {
  const sql = db();
  const [[totals], top] = await Promise.all([
    sql<{ pending: number; earned: number; credited: number; cents: number }[]>`
      select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'earned')::int as earned,
             count(*) filter (where status = 'credited')::int as credited, coalesce(sum(reward_cents), 0)::int as cents from referrals`,
    sql<{ referrer_user_id: string; friends: number; rewarded: number; cents: number }[]>`
      select referrer_user_id, count(*)::int as friends, count(*) filter (where status <> 'pending')::int as rewarded, coalesce(sum(reward_cents), 0)::int as cents
      from referrals group by referrer_user_id order by rewarded desc, friends desc limit 10`,
  ]);
  return { totals: totals ?? { pending: 0, earned: 0, credited: 0, cents: 0 }, top };
}

export async function recentEmails(limit = 30) {
  return db()<{ id: number; user_id: string; template: string; status: string; to_address: string | null; subject: string | null; last_error: string | null; updated_at: number }[]>`
    select id, user_id, template, status, to_address, subject, last_error, updated_at::float8 as updated_at from emails order by id desc limit ${limit}`;
}

/* ------------------------------ Admins ------------------------------ */

export async function adminList() {
  const admins = await db()<{ user_id: string; email: string; added_by: string; created_at: number }[]>`
    select user_id, email, added_by, created_at::float8 as created_at from admins order by created_at`;
  return { superadmins: superadminEmails(), admins };
}

/** Make the user with this email an admin (they must have signed up). */
export async function addAdmin(by: Admin, email: string): Promise<UserSummary> {
  const user = await userByEmail(email);
  if (!user) throw new HttpError(404, "no_user", "No Bamio account uses that email address. They need to sign up first.");
  if (superadminEmails().includes((user.email ?? "").toLowerCase())) throw new HttpError(409, "superadmin", "That person is already a superadmin.");
  await db()`insert into admins (user_id, email, added_by, created_at) values (${user.id}, ${user.email ?? email}, ${by.email}, ${Date.now()})
    on conflict (user_id) do nothing`;
  forgetAdminRoles();
  await logAdminAction(by, "admin.add", user.id, { email: user.email });
  return user;
}

export async function removeAdmin(by: Admin, userId: string) {
  const rows = await db()<{ email: string }[]>`delete from admins where user_id = ${userId} returning email`;
  if (rows.length === 0) throw new HttpError(404, "not_found", "That person isn’t an admin.");
  forgetAdminRoles();
  await logAdminAction(by, "admin.remove", userId, { email: rows[0]!.email });
}

export async function adminActions(limit = 50) {
  return db()<{ id: number; admin_email: string; action: string; target: string | null; details: Record<string, unknown>; at: number }[]>`
    select id, admin_email, action, target, details, at::float8 as at from admin_actions order by id desc limit ${limit}`;
}

/* ------------------------------ Job actions ------------------------------ */

/**
 * Cancel a queued or running job, or retry the newest failed (or cancelled) job of its kind
 * the way its owner would (Try again, Export, Find clips...). Logged.
 */
export async function adminJobAction(admin: Admin, jobId: number, action: "retry" | "cancel"): Promise<void> {
  const { enqueue } = await import("@/lib/server/queue");
  const { cancelJob, retryImport, startAnalysis, startExport, startRetranscribe } = await import("@/lib/server/jobs");
  const { getProject } = await import("@/lib/server/store");
  const job = await jobById(jobId);
  if (!job) throw new HttpError(404, "not_found", "That job doesn’t exist.");
  if (action === "cancel") {
    if (job.status !== "queued" && job.status !== "running") throw new HttpError(409, "not_active", "That job isn’t queued or running.");
    await cancelJob(job, "Stopped by the Bamio team. Try again, or contact us if it keeps happening.");
  } else {
    if (job.status !== "failed" && job.status !== "cancelled") throw new HttpError(409, "not_failed", "Only a failed or cancelled job can be retried.");
    if (!job.latest) throw new HttpError(409, "not_latest", "A newer job of this kind exists for this project.");
    switch (job.kind) {
      case "import":
      case "follow":
        await retryImport(job.userId, job.projectId);
        break;
      case "export":
        if (!job.clipId) throw new HttpError(409, "no_clip", "This export has no clip.");
        await startExport(job.userId, job.projectId, job.clipId);
        break;
      case "analyze":
        await startAnalysis(job.userId, job.projectId, (await getProject(job.userId, job.projectId)).clipLength);
        break;
      case "retranscribe":
        await startRetranscribe(job.userId, job.projectId);
        break;
      case "finish-follow":
        await enqueue({ kind: "finish-follow", userId: job.userId, projectId: job.projectId, maxAttempts: 3 });
        break;
      default:
        throw new HttpError(409, "unknown_kind", "This kind of job can’t be retried from here.");
    }
  }
  await logAdminAction(admin, `job.${action}`, String(job.id), { kind: job.kind, userId: job.userId, projectId: job.projectId });
}
