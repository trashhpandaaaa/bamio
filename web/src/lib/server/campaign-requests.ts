import "server-only";
import type { ClipPlatform } from "@/lib/campaigns/links";
import {
  MAX_WAITING_REQUESTS,
  sourceLink,
  type CampaignInput,
  type CampaignRequestInput,
  type CampaignStatus,
  type MyCampaignRequest,
  type RequestKind,
  type RequestStatus,
} from "@/lib/campaigns/schema";
import type { Admin } from "@/lib/server/admin";
import { createCampaign } from "@/lib/server/campaigns";
import { db } from "@/lib/server/db";
import { queueEmail } from "@/lib/server/email";
import { HttpError } from "@/lib/server/http";
import { isUserId } from "@/lib/server/store";

/*
 * Requests to run a clipping campaign. A podcaster, streamer or business fills in the "Run a
 * campaign" form on /clippers: their content, what to clip, a rate and a budget.
 * It waits for an admin (Admin, Campaigns), who looks at who is promising the money and either
 * makes the campaign from it (a draft, filled in from the request, opened like any other) or
 * declines it with a word why. The person who asked is emailed when their campaign goes live
 * (campaigns.ts) or is declined, and sees where it stands on /clippers. The team still approves
 * the clips. The owner pays Bamio for the campaign and Bamio pays the clippers (campaigns.ts):
 * the owner is never told how a clipper is paid. (The `payout` column held how an owner would
 * pay clippers, from when they did; it's no longer asked for or read.)
 */

type Row = {
  id: number;
  user_id: string;
  email: string | null;
  kind: RequestKind;
  name: string;
  source_url: string;
  brief: string;
  platforms: ClipPlatform[];
  rate_cents: number;
  budget_cents: number;
  contact: string;
  status: RequestStatus;
  note: string | null;
  campaign_id: string | null;
  campaign_slug: string | null;
  campaign_title: string | null;
  campaign_status: CampaignStatus | null;
  reviewed_by: string | null;
  created_at: number;
};

const select = (sql: ReturnType<typeof db>) => sql`
  r.id::int as id, r.user_id, r.email, r.kind, r.name, r.source_url, r.brief, r.platforms, r.rate_cents, r.budget_cents, r.contact, r.status, r.note,
  r.campaign_id, c.slug as campaign_slug, c.title as campaign_title, c.status as campaign_status, r.reviewed_by, r.created_at::float8 as created_at
  from campaign_requests r left join campaigns c on c.id = r.campaign_id`;

/** Ask to run a campaign. Its id. A few may wait at once per account, no more. */
export async function requestCampaign(userId: string, input: CampaignRequestInput, email: string | null, now = Date.now()): Promise<number> {
  if (!isUserId(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  const sql = db();
  const [waiting] = await sql<{ n: number }[]>`select count(*)::int as n from campaign_requests where user_id = ${userId} and status = 'pending'`;
  if ((waiting?.n ?? 0) >= MAX_WAITING_REQUESTS) {
    throw new HttpError(409, "too_many", `You have ${MAX_WAITING_REQUESTS} campaigns waiting for a look already. We’ll get to them first.`);
  }
  const [row] = await sql<{ id: number }[]>`
    insert into campaign_requests (user_id, email, kind, name, source_url, brief, platforms, rate_cents, budget_cents, contact, created_at)
    values (${userId}, ${email}, ${input.kind}, ${input.name}, ${sourceLink(input.sourceUrl) ?? input.sourceUrl}, ${input.brief}, ${sql.json(input.platforms)},
      ${input.rateCents}, ${input.budgetCents}, ${input.contact}, ${now})
    returning id::int as id`;
  return row!.id;
}

/** The user's own requests, the newest first, with the campaign made from each once there is one. */
export async function myCampaignRequests(userId: string): Promise<MyCampaignRequest[]> {
  const sql = db();
  const rows = await sql<Row[]>`select ${select(sql)} where r.user_id = ${userId} order by r.id desc limit 20`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    rateCents: r.rate_cents,
    budgetCents: r.budget_cents,
    status: r.status,
    note: r.status === "declined" ? r.note : null,
    campaign: r.campaign_slug && r.campaign_status ? { slug: r.campaign_slug, status: r.campaign_status } : null,
    createdAt: r.created_at,
  }));
}

/** Take back a request nobody has answered yet. */
export async function withdrawCampaignRequest(userId: string, id: number): Promise<void> {
  const sql = db();
  const gone = await sql`delete from campaign_requests where id = ${id} and user_id = ${userId} and status = 'pending' returning id`;
  if (gone.length > 0) return;
  const [mine] = await sql`select 1 from campaign_requests where id = ${id} and user_id = ${userId}`;
  if (!mine) throw new HttpError(404, "not_found", "That request isn’t there any more.");
  throw new HttpError(409, "answered", "That request has already been answered.");
}

/* ------------------------------ Admins ------------------------------ */

export type AdminCampaignRequest = {
  id: number;
  userId: string;
  email: string | null;
  kind: RequestKind;
  name: string;
  sourceUrl: string;
  brief: string;
  platforms: ClipPlatform[];
  rateCents: number;
  budgetCents: number;
  contact: string;
  status: RequestStatus;
  note: string | null;
  campaign: { id: string; slug: string; title: string; status: CampaignStatus } | null;
  reviewedBy: string | null;
  createdAt: number;
};

const forAdmin = (r: Row): AdminCampaignRequest => ({
  id: r.id,
  userId: r.user_id,
  email: r.email,
  kind: r.kind,
  name: r.name,
  sourceUrl: r.source_url,
  brief: r.brief,
  platforms: r.platforms,
  rateCents: r.rate_cents,
  budgetCents: r.budget_cents,
  contact: r.contact,
  status: r.status,
  note: r.note,
  campaign: r.campaign_id && r.campaign_slug && r.campaign_title && r.campaign_status ? { id: r.campaign_id, slug: r.campaign_slug, title: r.campaign_title, status: r.campaign_status } : null,
  reviewedBy: r.reviewed_by,
  createdAt: r.created_at,
});

/** Requests for admins: those waiting first (the oldest at the top), then the latest answered. */
export async function adminCampaignRequests(): Promise<AdminCampaignRequest[]> {
  const sql = db();
  const rows = await sql<Row[]>`
    select ${select(sql)}
    order by (r.status = 'pending') desc, case when r.status = 'pending' then r.id end, r.id desc limit 100`;
  return rows.map(forAdmin);
}

export async function adminCampaignRequest(id: number): Promise<AdminCampaignRequest | null> {
  const sql = db();
  const [row] = await sql<Row[]>`select ${select(sql)} where r.id = ${id}`;
  return row ? forAdmin(row) : null;
}

/** The request a campaign was made from (who asked for it, and how they'll pay), or null. */
export async function requestOfCampaign(campaignId: string): Promise<AdminCampaignRequest | null> {
  const sql = db();
  const [row] = await sql<Row[]>`select ${select(sql)} where r.campaign_id = ${campaignId} order by r.id limit 1`;
  return row ? forAdmin(row) : null;
}

/** How many requests wait for a look (the admin overview, the daily alert). */
export async function waitingRequests(): Promise<number> {
  const [row] = await db()<{ n: number }[]>`select count(*)::int as n from campaign_requests where status = 'pending'`;
  return row?.n ?? 0;
}

const log = async (admin: Admin, action: string, target: string, details: Record<string, unknown>) =>
  (await import("@/lib/server/admin")).logAdminAction(admin, action, target, details);

/** Decline a request, with a word why for the person who asked (they're emailed). Logged. */
export async function declineCampaignRequest(admin: Admin, id: number, note: string, now = Date.now()): Promise<void> {
  const sql = db();
  const [row] = await sql<{ user_id: string; name: string }[]>`
    update campaign_requests set status = 'declined', note = ${note || null}, reviewed_by = ${admin.email}, reviewed_at = ${now}
    where id = ${id} and status = 'pending'
    returning user_id, name`;
  if (!row) throw new HttpError(409, "answered", "That request has already been answered, or was taken back.");
  await queueEmail(row.user_id, `campaign-declined:${id}`, { template: "campaign-declined", name: row.name, note });
  await log(admin, "campaign.request.decline", String(id), { name: row.name, userId: row.user_id, ...(note ? { note } : {}) });
}

/**
 * Make the campaign a request asked for: a draft like any other, from what the admin filled in
 * (the form starts from the request). The request is tied to it, so the person who asked is
 * emailed when it goes live and admins see who they are. Logged.
 */
export async function createCampaignFromRequest(admin: Admin, requestId: number, input: CampaignInput, now = Date.now()): Promise<{ id: string; slug: string }> {
  const sql = db();
  const [waiting] = await sql<{ status: RequestStatus }[]>`select status from campaign_requests where id = ${requestId}`;
  if (!waiting) throw new HttpError(404, "not_found", "That request isn’t there any more.");
  if (waiting.status !== "pending") throw new HttpError(409, "answered", "That request has already been answered.");
  const made = await createCampaign(admin, input, now);
  const tied = await sql<{ user_id: string; name: string }[]>`
    update campaign_requests set status = 'accepted', campaign_id = ${made.id}, note = null, reviewed_by = ${admin.email}, reviewed_at = ${now}
    where id = ${requestId} and status = 'pending'
    returning user_id, name`;
  // Two admins at once: the first one's campaign is the request's; this draft stands alone.
  if (tied.length === 0) throw new HttpError(409, "answered", "Another admin just answered that request. Your draft is in Campaigns: delete it if it isn’t needed.");
  await log(admin, "campaign.request.accept", String(requestId), { name: tied[0]!.name, userId: tied[0]!.user_id, campaignId: made.id });
  return made;
}
