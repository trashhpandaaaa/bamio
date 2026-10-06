import "server-only";
import { randomUUID } from "node:crypto";
import { formatPrice } from "@/lib/billing/plans";
import { channelLink, clipLink, CLIP_PLATFORMS, type ClipLink, type ClipPlatform } from "@/lib/campaigns/links";
import { settle, type Settlement, type Terms } from "@/lib/campaigns/money";
import {
  CAMPAIGN_LIMITS,
  isOpen,
  slugify,
  sourceLink,
  type Campaign,
  type CampaignCard,
  type CampaignInput,
  type CampaignStats,
  type CampaignStatus,
  type ClipperInput,
  type ClipStatus,
  type JoinedCampaign,
  type Leader,
  type MyCampaign,
  type MyClip,
  type MyClipper,
} from "@/lib/campaigns/schema";
import type { Admin } from "@/lib/server/admin";
import { db, type Sql, type Tx } from "@/lib/server/db";
import { queueEmail } from "@/lib/server/email";
import { HttpError } from "@/lib/server/http";
import { isUserId } from "@/lib/server/store";

/*
 * Clipping campaigns (/clippers). An admin sets one up: what to clip, a rate per 1,000 views, a
 * budget. Clippers join it, clip with Bamio, post on their own channels and send the links.
 * Each clip waits for an admin; approved ones count. Bamio reads the views itself where the
 * site allows (campaign-views.ts) and an admin types them in where it doesn't; money.ts says
 * what the views are worth. Nothing is paid through Bamio: the campaign's owner pays each
 * clipper directly and an admin records it here (campaign_payouts), so everyone sees what was
 * earned, paid and is still owed. Deleting an account removes its clipper, memberships and
 * clips, and keeps only the amounts already paid (accounts.ts).
 */

/** Woken when a clip is sent or should be counted again (campaign-views.ts listens). */
export const VIEWS_CHANNEL = "bamio_campaign_views";

type CampaignRow = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  summary: string;
  brief: string;
  rules: string;
  source_url: string | null;
  platforms: ClipPlatform[];
  rate_cents: number;
  budget_cents: number;
  min_views: number;
  max_clip_cents: number | null;
  payout: string;
  status: CampaignStatus;
  ends_at: number | null;
  created_at: number;
};

const cols = (sql: Sql | Tx) =>
  sql`id, slug, title, brand, summary, brief, rules, source_url, platforms, rate_cents, budget_cents, min_views, max_clip_cents, payout, status,
      ends_at::float8 as ends_at, created_at::float8 as created_at`;

const campaign = (r: CampaignRow): Campaign => ({
  id: r.id,
  slug: r.slug,
  title: r.title,
  brand: r.brand,
  summary: r.summary,
  brief: r.brief,
  rules: r.rules ? r.rules.split("\n") : [],
  sourceUrl: r.source_url,
  platforms: r.platforms,
  rateCents: r.rate_cents,
  budgetCents: r.budget_cents,
  minViews: r.min_views,
  maxClipCents: r.max_clip_cents,
  payout: r.payout,
  status: r.status,
  endsAt: r.ends_at,
  createdAt: r.created_at,
});

const terms = (r: CampaignRow): Terms => ({ rateCents: r.rate_cents, budgetCents: r.budget_cents, minViews: r.min_views, maxClipCents: r.max_clip_cents });

const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const isSlug = (slug: string) => /^[a-z0-9-]{3,70}$/.test(slug);
const notFound = () => new HttpError(404, "not_found", "That campaign doesn’t exist.");

/** Earned, paid and owed for each of these campaigns, from the clips that count and the payments recorded. */
async function settlements(rows: CampaignRow[], sql: Sql | Tx = db()): Promise<Map<string, Settlement>> {
  const out = new Map<string, Settlement>();
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return out;
  const clips = await sql<{ id: number; campaign_id: string; user_id: string; views: number; approved_at: number }[]>`
    select c.id::int as id, c.campaign_id, c.user_id, coalesce(c.views_manual, c.views, 0)::float8 as views, coalesce(c.reviewed_at, c.created_at)::float8 as approved_at
    from campaign_clips c join clippers k on k.user_id = c.user_id
    where c.campaign_id in ${sql(ids)} and c.status = 'approved' and k.blocked_at is null`;
  const payouts = await sql<{ campaign_id: string; user_id: string | null; amount_cents: number }[]>`
    select campaign_id, user_id, amount_cents from campaign_payouts where campaign_id in ${sql(ids)}`;
  for (const r of rows) {
    out.set(
      r.id,
      settle(
        terms(r),
        clips.filter((c) => c.campaign_id === r.id).map((c) => ({ id: c.id, userId: c.user_id, views: c.views, approvedAt: c.approved_at })),
        payouts.filter((p) => p.campaign_id === r.id).map((p) => ({ userId: p.user_id, amountCents: p.amount_cents })),
      ),
    );
  }
  return out;
}

async function memberCounts(ids: string[], sql: Sql | Tx = db()): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await sql<{ campaign_id: string; n: number }[]>`
    select m.campaign_id, count(*)::int as n from campaign_members m join clippers k on k.user_id = m.user_id
    where m.campaign_id in ${sql(ids)} and k.blocked_at is null group by m.campaign_id`;
  return new Map(rows.map((r) => [r.campaign_id, r.n]));
}

const stats = (r: CampaignRow, s: Settlement, members: number): CampaignStats => ({
  spentCents: Math.min(s.spentCents, r.budget_cents),
  clippers: members,
  clips: s.clips.size,
  views: s.views,
});

/* ------------------------------ The public pages ------------------------------ */

/** Every campaign people can see: live ones first, then paused, then finished; the newest first. */
export async function listCampaigns(): Promise<CampaignCard[]> {
  const sql = db();
  const rows = await sql<CampaignRow[]>`
    select ${cols(sql)} from campaigns where status <> 'draft'
    order by array_position(array['live', 'paused', 'ended'], status), created_at desc limit 200`;
  const [done, members] = await Promise.all([settlements(rows), memberCounts(rows.map((r) => r.id))]);
  return rows.map((r) => ({ ...campaign(r), stats: stats(r, done.get(r.id)!, members.get(r.id) ?? 0) }));
}

export type CampaignPage = { campaign: CampaignCard; leaders: Leader[] };

/** A campaign's page: its terms, how it's doing, and who has earned the most. `drafts`: for admins looking before it goes live. */
export async function campaignBySlug(slug: string, opts: { drafts?: boolean } = {}): Promise<CampaignPage | null> {
  if (!isSlug(slug)) return null;
  const sql = db();
  const [row] = await sql<CampaignRow[]>`select ${cols(sql)} from campaigns where slug = ${slug}`;
  if (!row || (row.status === "draft" && !opts.drafts)) return null;
  const [done, members] = await Promise.all([settlements([row]), memberCounts([row.id])]);
  const s = done.get(row.id)!;
  const top = [...s.clippers.entries()]
    .filter(([, t]) => t.clips > 0)
    .sort(([, a], [, b]) => b.earnedCents - a.earnedCents || b.views - a.views)
    .slice(0, 50);
  const people = top.length
    ? await sql<{ user_id: string; name: string; link: string | null; image_url: string | null }[]>`
        select user_id, name, link, image_url from clippers where user_id in ${sql(top.map(([id]) => id))}`
    : [];
  const leaders = top.flatMap(([userId, t]) => {
    const who = people.find((p) => p.user_id === userId);
    return who ? [{ name: who.name, imageUrl: who.image_url, link: who.link ? channelLink(who.link) : null, clips: t.clips, views: t.views, earnedCents: t.earnedCents }] : [];
  });
  return { campaign: { ...campaign(row), stats: stats(row, s, members.get(row.id) ?? 0) }, leaders };
}

/* ------------------------------ Clippers ------------------------------ */

type ClipperRow = { user_id: string; name: string; link: string | null; image_url: string | null; payout: string; blocked_at: number | null };
const mine = (r: ClipperRow): MyClipper => ({ name: r.name, link: r.link ?? "", payout: r.payout, imageUrl: r.image_url, blocked: r.blocked_at !== null });

/** The user's clipper details, or null when they've never joined a campaign. */
export async function myClipper(userId: string, sql: Sql | Tx = db()): Promise<MyClipper | null> {
  const [row] = await sql<ClipperRow[]>`select user_id, name, link, image_url, payout, blocked_at::float8 as blocked_at from clippers where user_id = ${userId}`;
  return row ? mine(row) : null;
}

/** Save who the user is in campaigns: their name, channel, picture and how to pay them. */
export async function saveClipper(userId: string, input: ClipperInput, imageUrl: string | null, sql: Sql | Tx = db(), now = Date.now()): Promise<MyClipper> {
  if (!isUserId(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  const link = channelLink(input.link)?.url ?? null;
  const [row] = await sql<ClipperRow[]>`
    insert into clippers (user_id, name, link, image_url, payout, created_at, updated_at)
    values (${userId}, ${input.name}, ${link}, ${imageUrl}, ${input.payout}, ${now}, ${now})
    on conflict (user_id) do update set name = excluded.name, link = excluded.link, image_url = excluded.image_url, payout = excluded.payout, updated_at = excluded.updated_at
    returning user_id, name, link, image_url, payout, blocked_at::float8 as blocked_at`;
  return mine(row!);
}

const BLOCKED = "Your account can’t take part in campaigns.";

async function publicRow(slug: string, sql: Sql | Tx = db()): Promise<CampaignRow> {
  if (!isSlug(slug)) throw notFound();
  const [row] = await sql<CampaignRow[]>`select ${cols(sql)} from campaigns where slug = ${slug} and status <> 'draft'`;
  if (!row) throw notFound();
  return row;
}

/** Join a campaign, saving the clipper's details with it. Joining twice changes nothing. */
export async function joinCampaign(userId: string, slug: string, input: ClipperInput, imageUrl: string | null, now = Date.now()): Promise<void> {
  const row = await publicRow(slug);
  if (!isOpen(row)) throw new HttpError(409, "closed", row.status === "ended" ? "This campaign has ended." : "This campaign isn’t taking new clippers right now.");
  if ((await myClipper(userId))?.blocked) throw new HttpError(403, "blocked", BLOCKED);
  await db().begin(async (tx) => {
    await saveClipper(userId, input, imageUrl, tx, now);
    await tx`insert into campaign_members (campaign_id, user_id, joined_at) values (${row.id}, ${userId}, ${now}) on conflict do nothing`;
  });
}

type ClipRow = {
  id: number;
  url: string;
  platform: ClipPlatform;
  status: ClipStatus;
  note: string | null;
  views: number | null;
  views_manual: number | null;
  views_error: string | null;
  created_at: number;
};

/** The user's place in a campaign: whether they joined, their clips, and what they've earned and been paid. */
export async function myCampaign(userId: string, slug: string): Promise<MyCampaign> {
  const sql = db();
  const row = await publicRow(slug);
  const [clipper, members, clips, done] = await Promise.all([
    myClipper(userId),
    sql`select 1 from campaign_members where campaign_id = ${row.id} and user_id = ${userId}`,
    sql<ClipRow[]>`
      select id::int as id, url, platform, status, note, views::float8 as views, views_manual::float8 as views_manual, views_error, created_at::float8 as created_at
      from campaign_clips where campaign_id = ${row.id} and user_id = ${userId} order by id desc`,
    settlements([row]),
  ]);
  const s = done.get(row.id)!;
  const totals = s.clippers.get(userId);
  return {
    clipper,
    joined: members.length > 0,
    clips: clips.map((c): MyClip => {
      const views = c.views_manual ?? c.views;
      return {
        id: c.id,
        url: c.url,
        platform: c.platform,
        status: c.status,
        note: c.status === "rejected" ? c.note : null,
        views,
        byHand: views === null && (c.views_error !== null || !CLIP_PLATFORMS[c.platform]?.counted),
        earnedCents: s.clips.get(c.id) ?? 0,
        createdAt: c.created_at,
      };
    }),
    earnedCents: totals?.earnedCents ?? 0,
    paidCents: totals?.paidCents ?? 0,
    owedCents: totals?.owedCents ?? 0,
  };
}

/** The campaigns the user joined, the newest first, with what each has earned them. */
export async function myCampaigns(userId: string): Promise<JoinedCampaign[]> {
  const sql = db();
  const rows = await sql<CampaignRow[]>`
    select ${cols(sql)} from campaigns where status <> 'draft' and id in (select campaign_id from campaign_members where user_id = ${userId})
    order by created_at desc limit 100`;
  if (rows.length === 0) return [];
  const [done, counts] = await Promise.all([
    settlements(rows),
    sql<{ campaign_id: string; clips: number; waiting: number }[]>`
      select campaign_id, count(*) filter (where status <> 'rejected')::int as clips, count(*) filter (where status = 'pending')::int as waiting
      from campaign_clips where user_id = ${userId} and campaign_id in ${sql(rows.map((r) => r.id))} group by campaign_id`,
  ]);
  return rows.map((r) => {
    const totals = done.get(r.id)!.clippers.get(userId);
    const count = counts.find((c) => c.campaign_id === r.id);
    return { slug: r.slug, title: r.title, brand: r.brand, status: r.status, clips: count?.clips ?? 0, waiting: count?.waiting ?? 0, earnedCents: totals?.earnedCents ?? 0, owedCents: totals?.owedCents ?? 0 };
  });
}

/** Follow a TikTok share link to the post it stands for. Null when it can't be followed. */
export type LinkResolver = (link: ClipLink) => Promise<ClipLink | null>;

/**
 * Only addresses clipLink made are fetched (TikTok's own, over https), redirects are read, not
 * followed blindly, and each hop must again be a TikTok link.
 */
export const resolveClipLink: LinkResolver = async (link) => {
  let at = link;
  for (let hop = 0; hop < 3 && at.short; hop++) {
    let location: string | null;
    try {
      const res = await fetch(at.url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(6000), headers: { "user-agent": "Mozilla/5.0 (compatible; Bamio/1.0; +https://bamio.app)" } });
      location = res.headers.get("location");
    } catch {
      return null;
    }
    const next = location ? clipLink(new URL(location, at.url).href) : null;
    if (!next) return null;
    at = next;
  }
  return at.short ? null : at;
};

const platformNames = (list: ClipPlatform[]) => list.map((p) => CLIP_PLATFORMS[p].name).join(", ");

/** Send a clip the user posted. It waits for an admin; the same post can't be sent twice. */
export async function submitClip(userId: string, slug: string, input: string, resolve: LinkResolver = resolveClipLink, now = Date.now()): Promise<void> {
  const sql = db();
  const row = await publicRow(slug);
  if (!isOpen(row)) throw new HttpError(409, "closed", row.status === "ended" ? "This campaign has ended." : "This campaign isn’t taking clips right now.");
  const [member] = await sql`select 1 from campaign_members where campaign_id = ${row.id} and user_id = ${userId}`;
  if (!member) throw new HttpError(403, "not_joined", "Join the campaign first.");
  if ((await myClipper(userId))?.blocked) throw new HttpError(403, "blocked", BLOCKED);

  let link = clipLink(input);
  if (!link) throw new HttpError(400, "bad_link", `Paste the link to your clip’s own page on ${platformNames(row.platforms)}.`);
  if (link.short) {
    link = await resolve(link);
    if (!link) throw new HttpError(400, "short_link", "Bamio couldn’t follow that share link. Open your clip in a browser and paste its full link (tiktok.com/@you/video/...).");
  }
  if (!row.platforms.includes(link.platform)) throw new HttpError(400, "wrong_platform", `This campaign takes clips posted on ${platformNames(row.platforms)}.`);

  const [count] = await sql<{ clips: number; waiting: number }[]>`
    select count(*) filter (where status <> 'rejected')::int as clips, count(*) filter (where status = 'pending')::int as waiting
    from campaign_clips where campaign_id = ${row.id} and user_id = ${userId}`;
  if ((count?.clips ?? 0) >= CAMPAIGN_LIMITS.clips) throw new HttpError(409, "too_many", `A campaign takes up to ${CAMPAIGN_LIMITS.clips} clips from each clipper.`);
  if ((count?.waiting ?? 0) >= CAMPAIGN_LIMITS.waiting) throw new HttpError(409, "too_many_waiting", `${CAMPAIGN_LIMITS.waiting} of your clips are waiting for a look. Send more once some are through.`);

  const added = await sql`
    insert into campaign_clips (campaign_id, user_id, url, url_key, platform, created_at) values (${row.id}, ${userId}, ${link.url}, ${link.key}, ${link.platform}, ${now})
    on conflict (campaign_id, url_key) do nothing returning id`;
  if (added.length === 0) throw new HttpError(409, "duplicate", "That clip was already sent to this campaign.");
  await sql`select pg_notify(${VIEWS_CHANNEL}, '')`;
}

/** Take back a clip that's still waiting for a look. */
export async function withdrawClip(userId: string, clipId: number): Promise<void> {
  const sql = db();
  const gone = await sql`delete from campaign_clips where id = ${clipId} and user_id = ${userId} and status = 'pending' returning id`;
  if (gone.length > 0) return;
  const [clip] = await sql`select 1 from campaign_clips where id = ${clipId} and user_id = ${userId}`;
  if (!clip) throw new HttpError(404, "not_found", "That clip isn’t in this campaign.");
  throw new HttpError(409, "reviewed", "Only a clip that’s still waiting can be taken back.");
}

/* ------------------------------ Ending ------------------------------ */

/** End a running campaign whose budget is used up. True when it ended now. */
export async function closeIfSpent(campaignId: string, now = Date.now()): Promise<boolean> {
  const sql = db();
  const [row] = await sql<CampaignRow[]>`select ${cols(sql)} from campaigns where id = ${campaignId} and status in ('live', 'paused')`;
  if (!row || (await settlements([row])).get(row.id)!.leftCents > 0) return false;
  const ended = await sql`update campaigns set status = 'ended', updated_at = ${now} where id = ${campaignId} and status in ('live', 'paused') returning id`;
  return ended.length > 0;
}

/** End the running campaigns whose last day has passed. */
export async function endDueCampaigns(now = Date.now()): Promise<number> {
  const ended = await db()`update campaigns set status = 'ended', updated_at = ${now} where status in ('live', 'paused') and ends_at is not null and ends_at <= ${now} returning id`;
  return ended.length;
}

/* ------------------------------ Admins ------------------------------ */

const log = async (admin: Admin, action: string, target: string | null, details: Record<string, unknown> = {}) =>
  (await import("@/lib/server/admin")).logAdminAction(admin, action, target, details);

const values = (input: CampaignInput) => ({
  title: input.title,
  brand: input.brand,
  summary: input.summary,
  brief: input.brief,
  rules: input.rules,
  source_url: input.sourceUrl ? sourceLink(input.sourceUrl) : null,
  rate_cents: input.rateCents,
  budget_cents: input.budgetCents,
  min_views: input.minViews,
  max_clip_cents: input.maxClipCents,
  payout: input.payout,
  ends_at: input.endsAt,
});

/** Make a campaign, as a draft only admins see. Its address comes from its title. */
export async function createCampaign(admin: Admin, input: CampaignInput, now = Date.now()): Promise<{ id: string; slug: string }> {
  const sql = db();
  const id = randomUUID();
  const base = slugify(input.title);
  for (let n = 1; n <= 30; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const made = await sql`
      insert into campaigns ${sql({ id, slug, ...values(input), platforms: sql.json(input.platforms), status: "draft", created_by: admin.email, created_at: now, updated_at: now })}
      on conflict (slug) do nothing returning id`;
    if (made.length > 0) {
      await log(admin, "campaign.create", id, { slug, title: input.title });
      return { id, slug };
    }
  }
  throw new HttpError(409, "slug_taken", "Too many campaigns share that title. Change it a little.");
}

/** Change a campaign's words and terms (its address stays). */
export async function updateCampaign(admin: Admin, id: string, input: CampaignInput, now = Date.now()): Promise<void> {
  if (!isUuid(id)) throw notFound();
  const sql = db();
  const changed = await sql`update campaigns set ${sql({ ...values(input), platforms: sql.json(input.platforms), updated_at: now })} where id = ${id} returning id`;
  if (changed.length === 0) throw notFound();
  await closeIfSpent(id, now);
  await log(admin, "campaign.update", id, { title: input.title, rateCents: input.rateCents, budgetCents: input.budgetCents });
}

/** Open, pause or end a campaign. One that has been public can't go back to a draft; one with no budget left can't reopen. */
export async function setCampaignStatus(admin: Admin, id: string, status: Exclude<CampaignStatus, "draft">, now = Date.now()): Promise<void> {
  if (!isUuid(id)) throw notFound();
  const sql = db();
  const [row] = await sql<CampaignRow[]>`select ${cols(sql)} from campaigns where id = ${id}`;
  if (!row) throw notFound();
  if (status === "live" && (await settlements([row])).get(row.id)!.leftCents <= 0) throw new HttpError(409, "spent", "The budget is used up. Raise it before opening the campaign again.");
  if (status === "live" && row.ends_at !== null && row.ends_at <= now) throw new HttpError(409, "over", "Its last day has passed. Move the end date before opening it again.");
  if (status === "paused" && row.status === "draft") throw new HttpError(409, "draft", "A draft can go live or be deleted.");
  await sql`update campaigns set status = ${status}, updated_at = ${now} where id = ${id}`;
  await log(admin, `campaign.${status}`, id, { title: row.title, was: row.status });
}

/** Delete a draft (a campaign people have seen is ended instead, so its record stays). */
export async function deleteCampaign(admin: Admin, id: string): Promise<void> {
  if (!isUuid(id)) throw notFound();
  const gone = await db()<{ title: string }[]>`delete from campaigns where id = ${id} and status = 'draft' returning title`;
  if (gone.length === 0) throw new HttpError(409, "not_draft", "Only a draft can be deleted. End a campaign that has been live.");
  await log(admin, "campaign.delete", id, { title: gone[0]!.title });
}

export type AdminCampaignRow = CampaignCard & { waiting: number; owedCents: number; createdBy: string };

/** Every campaign, drafts too, the newest first, with the clips waiting for a look and what is owed. */
export async function adminCampaigns(): Promise<AdminCampaignRow[]> {
  const sql = db();
  const rows = await sql<(CampaignRow & { created_by: string })[]>`select ${cols(sql)}, created_by from campaigns order by created_at desc limit 300`;
  const ids = rows.map((r) => r.id);
  const [done, members, waiting] = await Promise.all([
    settlements(rows),
    memberCounts(ids),
    ids.length
      ? sql<{ campaign_id: string; n: number }[]>`select campaign_id, count(*)::int as n from campaign_clips where status = 'pending' and campaign_id in ${sql(ids)} group by campaign_id`
      : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const s = done.get(r.id)!;
    return {
      ...campaign(r),
      stats: { ...stats(r, s, members.get(r.id) ?? 0), spentCents: s.spentCents },
      waiting: waiting.find((w) => w.campaign_id === r.id)?.n ?? 0,
      owedCents: [...s.clippers.values()].reduce((sum, t) => sum + t.owedCents, 0),
      createdBy: r.created_by,
    };
  });
}

export type AdminClip = {
  id: number;
  userId: string;
  name: string;
  channel: string | null;
  blocked: boolean;
  url: string;
  platform: ClipPlatform;
  status: ClipStatus;
  note: string | null;
  /** What Bamio read, what an admin typed (it wins), and the number that counts. */
  counted: number | null;
  byHand: number | null;
  views: number;
  checkedAt: number | null;
  error: string | null;
  title: string | null;
  author: string | null;
  earnedCents: number;
  reviewedBy: string | null;
  createdAt: number;
};

export type AdminClipper = {
  userId: string;
  name: string;
  link: string | null;
  imageUrl: string | null;
  payout: string;
  blocked: boolean;
  joinedAt: number;
  clips: number;
  waiting: number;
  views: number;
  earnedCents: number;
  paidCents: number;
  owedCents: number;
};

export type AdminPayout = { id: number; userId: string | null; name: string | null; amountCents: number; note: string; paidBy: string; paidAt: number };

export type AdminCampaign = {
  campaign: Campaign;
  spentCents: number;
  leftCents: number;
  views: number;
  clips: AdminClip[];
  clippers: AdminClipper[];
  payouts: AdminPayout[];
};

/** Everything an admin works with in one campaign: clips to look at (those waiting first), its clippers and what they're owed, the payments recorded. */
export async function adminCampaign(id: string): Promise<AdminCampaign | null> {
  if (!isUuid(id)) return null;
  const sql = db();
  const [row] = await sql<CampaignRow[]>`select ${cols(sql)} from campaigns where id = ${id}`;
  if (!row) return null;
  const [done, clips, members, payouts] = await Promise.all([
    settlements([row]),
    sql<Record<string, unknown>[]>`
      select c.id::int as id, c.user_id, k.name, k.link, k.blocked_at, c.url, c.platform, c.status, c.note, c.views::float8 as views, c.views_manual::float8 as views_manual,
             c.views_checked_at::float8 as checked_at, c.views_error, c.title, c.author, c.reviewed_by, c.created_at::float8 as created_at
      from campaign_clips c left join clippers k on k.user_id = c.user_id
      where c.campaign_id = ${id}
      order by array_position(array['pending', 'approved', 'rejected'], c.status), c.id desc limit 1000`,
    sql<Record<string, unknown>[]>`
      select m.user_id, m.joined_at::float8 as joined_at, k.name, k.link, k.image_url, k.payout, k.blocked_at,
             (select count(*)::int from campaign_clips c where c.campaign_id = m.campaign_id and c.user_id = m.user_id and c.status = 'pending') as waiting
      from campaign_members m join clippers k on k.user_id = m.user_id
      where m.campaign_id = ${id} order by m.joined_at limit 1000`,
    sql<Record<string, unknown>[]>`
      select p.id::int as id, p.user_id, k.name, p.amount_cents, p.note, p.paid_by, p.paid_at::float8 as paid_at
      from campaign_payouts p left join clippers k on k.user_id = p.user_id
      where p.campaign_id = ${id} order by p.id desc limit 500`,
  ]);
  const s = done.get(row.id)!;
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  return {
    campaign: campaign(row),
    spentCents: s.spentCents,
    leftCents: s.leftCents,
    views: s.views,
    clips: clips.map((c) => ({
      id: Number(c.id),
      userId: String(c.user_id),
      name: text(c.name) ?? "Someone who left",
      channel: text(c.link),
      blocked: c.blocked_at !== null && c.blocked_at !== undefined,
      url: String(c.url),
      platform: c.platform as ClipPlatform,
      status: c.status as ClipStatus,
      note: text(c.note),
      counted: num(c.views),
      byHand: num(c.views_manual),
      views: num(c.views_manual) ?? num(c.views) ?? 0,
      checkedAt: num(c.checked_at),
      error: text(c.views_error),
      title: text(c.title),
      author: text(c.author),
      earnedCents: s.clips.get(Number(c.id)) ?? 0,
      reviewedBy: text(c.reviewed_by),
      createdAt: Number(c.created_at),
    })),
    clippers: members
      .map((m) => {
        const totals = s.clippers.get(String(m.user_id));
        return {
          userId: String(m.user_id),
          name: String(m.name),
          link: text(m.link),
          imageUrl: text(m.image_url),
          payout: String(m.payout ?? ""),
          blocked: m.blocked_at !== null,
          joinedAt: Number(m.joined_at),
          clips: totals?.clips ?? 0,
          waiting: Number(m.waiting),
          views: totals?.views ?? 0,
          earnedCents: totals?.earnedCents ?? 0,
          paidCents: totals?.paidCents ?? 0,
          owedCents: totals?.owedCents ?? 0,
        };
      })
      .sort((a, b) => b.owedCents - a.owedCents || b.earnedCents - a.earnedCents || a.joinedAt - b.joinedAt),
    payouts: payouts.map((p) => ({ id: Number(p.id), userId: text(p.user_id), name: text(p.name), amountCents: Number(p.amount_cents), note: String(p.note ?? ""), paidBy: String(p.paid_by), paidAt: Number(p.paid_at) })),
  };
}

/** For the admin overview: campaigns open now, and clips waiting for a look in campaigns that are running. */
export async function campaignCounts(): Promise<{ live: number; waiting: number }> {
  const [row] = await db()<{ live: number; waiting: number }[]>`
    select (select count(*)::int from campaigns where status = 'live') as live,
           (select count(*)::int from campaign_clips c join campaigns g on g.id = c.campaign_id where c.status = 'pending' and g.status <> 'draft') as waiting`;
  return row ?? { live: 0, waiting: 0 };
}

/**
 * Approve a clip (it counts from now, in the order clips were approved) or reject it, with a
 * word for its clipper about why. Either can be changed later. Logged.
 */
export async function reviewClip(admin: Admin, clipId: number, action: "approve" | "reject", note = "", now = Date.now()): Promise<void> {
  const sql = db();
  const status: ClipStatus = action === "approve" ? "approved" : "rejected";
  const [clip] = await sql<{ campaign_id: string; user_id: string; url: string }[]>`
    update campaign_clips set
      reviewed_at = case when status = 'approved' and ${status} = 'approved' then reviewed_at else ${now}::bigint end,
      status = ${status}, note = ${action === "reject" ? note || null : null}, reviewed_by = ${admin.email}
    where id = ${clipId}
    returning campaign_id, user_id, url`;
  if (!clip) throw new HttpError(404, "not_found", "That clip isn’t there any more.");
  if (action === "approve") await closeIfSpent(clip.campaign_id, now);
  await log(admin, `campaign.clip.${action}`, String(clipId), { campaignId: clip.campaign_id, userId: clip.user_id, url: clip.url, ...(note ? { note } : {}) });
}

/** Set a clip's views by hand (the number then wins over what Bamio reads), or clear it with null. Logged. */
export async function setClipViews(admin: Admin, clipId: number, views: number | null, now = Date.now()): Promise<void> {
  const [clip] = await db()<{ campaign_id: string }[]>`update campaign_clips set views_manual = ${views} where id = ${clipId} returning campaign_id`;
  if (!clip) throw new HttpError(404, "not_found", "That clip isn’t there any more.");
  await closeIfSpent(clip.campaign_id, now);
  await log(admin, "campaign.clip.views", String(clipId), { campaignId: clip.campaign_id, views });
}

/** Have Bamio read a clip's views again now. */
export async function recountClip(clipId: number): Promise<void> {
  const sql = db();
  const [clip] = await sql<{ platform: ClipPlatform }[]>`select platform from campaign_clips where id = ${clipId}`;
  if (!clip) throw new HttpError(404, "not_found", "That clip isn’t there any more.");
  if (!CLIP_PLATFORMS[clip.platform]?.counted) throw new HttpError(409, "by_hand", `${CLIP_PLATFORMS[clip.platform]?.name ?? "That site"} doesn’t show views to Bamio. Type the number in.`);
  await sql`update campaign_clips set views_checked_at = null, views_error = null where id = ${clipId}`;
  await sql`select pg_notify(${VIEWS_CHANNEL}, '')`;
}

/**
 * Write down a payment the campaign's owner made to a clipper (outside Bamio), never more than
 * they're owed. The clipper is emailed, so they can say if it didn't arrive. Logged.
 */
export async function recordPayout(admin: Admin, campaignId: string, userId: string, amountCents: number, note: string, now = Date.now()): Promise<void> {
  if (!isUuid(campaignId) || !isUserId(userId)) throw notFound();
  const title = await db().begin(async (tx) => {
    const [row] = await tx<CampaignRow[]>`select ${cols(tx)} from campaigns where id = ${campaignId} for update`;
    if (!row) throw notFound();
    const owed = (await settlements([row], tx)).get(row.id)!.clippers.get(userId)?.owedCents ?? 0;
    if (amountCents > owed) {
      throw new HttpError(409, "too_much", owed > 0 ? `They’re owed ${formatPrice(owed)}. Record that much or less.` : "Nothing is owed to this clipper right now.");
    }
    const [paid] = await tx<{ id: number }[]>`
      insert into campaign_payouts (campaign_id, user_id, amount_cents, note, paid_by, paid_at) values (${campaignId}, ${userId}, ${amountCents}, ${note}, ${admin.email}, ${now})
      returning id::int as id`;
    await queueEmail(userId, `campaign-paid:${paid!.id}`, { template: "campaign-paid", campaign: row.title, brand: row.brand, slug: row.slug, amountCents, note }, tx, now);
    return row.title;
  });
  await log(admin, "campaign.payout", userId, { campaignId, title, amountCents, ...(note ? { note } : {}) });
}

/** Block a clipper (off every leaderboard, earning nothing, unable to join or send clips) or let them back. Logged. */
export async function blockClipper(admin: Admin, userId: string, blocked: boolean, now = Date.now()): Promise<void> {
  const rows = await db()<{ name: string }[]>`update clippers set blocked_at = ${blocked ? now : null}, updated_at = ${now} where user_id = ${userId} returning name`;
  if (rows.length === 0) throw new HttpError(404, "not_found", "That person isn’t a clipper.");
  await log(admin, blocked ? "clipper.block" : "clipper.unblock", userId, { name: rows[0]!.name });
}
