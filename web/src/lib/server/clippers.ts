import "server-only";
import type { Admin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { queueEmail } from "@/lib/server/email";
import { HttpError } from "@/lib/server/http";
import { isUserId } from "@/lib/server/store";
import { clipperLink, type ClipperCard, type ClipperInput, type ClipperStatus, type MyClipper } from "@/lib/profile/clipper";

/*
 * The Clippers page (/clippers): users who chose to be shown, once an admin has approved them.
 * A user's entry exists only while they want to be listed (the profile's switch saves or
 * removes it). It starts "pending"; an admin approves or hides it (the admin panel's Clippers);
 * whatever the user changes afterwards goes back to "pending", so what's public is always
 * something an admin has seen. Deleting the account removes it (accounts.ts).
 */

type Row = { user_id: string; name: string; bio: string; link: string | null; image_url: string | null; status: ClipperStatus };

const mine = (r: Row): MyClipper => ({ name: r.name, bio: r.bio, link: r.link ?? "", status: r.status, imageUrl: r.image_url });

/** The user's own entry, or null when they aren't listed. */
export async function myClipper(userId: string): Promise<MyClipper | null> {
  const [row] = await db()<Row[]>`select user_id, name, bio, link, image_url, status from clipper_profiles where user_id = ${userId}`;
  return row ? mine(row) : null;
}

/**
 * List the user (or change their entry). New entries and changed ones wait for an admin;
 * saving the same name, line and link again keeps an approval (and refreshes the picture).
 */
export async function saveClipper(userId: string, input: ClipperInput, imageUrl: string | null, now = Date.now()): Promise<MyClipper> {
  if (!isUserId(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  const link = input.link ? (clipperLink(input.link)?.url ?? null) : null;
  const [row] = await db()<Row[]>`
    insert into clipper_profiles (user_id, name, bio, link, image_url, status, created_at, updated_at)
    values (${userId}, ${input.name}, ${input.bio}, ${link}, ${imageUrl}, 'pending', ${now}, ${now})
    on conflict (user_id) do update set
      status = case
        when clipper_profiles.name = excluded.name and clipper_profiles.bio = excluded.bio and clipper_profiles.link is not distinct from excluded.link
        then clipper_profiles.status else 'pending' end,
      name = excluded.name, bio = excluded.bio, link = excluded.link, image_url = excluded.image_url, updated_at = excluded.updated_at
    returning user_id, name, bio, link, image_url, status`;
  forgetClippers();
  return mine(row!);
}

/** Stop listing the user. */
export async function removeClipper(userId: string): Promise<void> {
  await db()`delete from clipper_profiles where user_id = ${userId}`;
  forgetClippers();
}

/* ------------------------------ The public page ------------------------------ */

type Cached = { at: number; cards: ClipperCard[] };
const cache = globalThis as { __bamioClippers?: Cached };
const forgetClippers = () => (cache.__bamioClippers = undefined);

/**
 * The approved clippers, those with the most exported clips first (then the newest). Kept a
 * minute: counting clips reads every project they keep.
 */
export async function listClippers(now = Date.now()): Promise<ClipperCard[]> {
  const hit = cache.__bamioClippers;
  if (hit && now - hit.at < 60_000) return hit.cards;
  const rows = await db()<(Row & { clips: number })[]>`
    select c.user_id, c.name, c.bio, c.link, c.image_url, c.status,
           coalesce((
             select sum(jsonb_array_length(jsonb_path_query_array(p.data, '$.clips[*] ? (@.export.status == "done")')))
             from projects p where p.user_id = c.user_id
           ), 0)::int as clips
    from clipper_profiles c
    where c.status = 'approved'
    order by clips desc, c.approved_at desc
    limit 300`;
  const cards = rows.map((r) => ({ name: r.name, bio: r.bio, link: r.link ? clipperLink(r.link) : null, imageUrl: r.image_url, clips: r.clips }));
  cache.__bamioClippers = { at: now, cards };
  return cards;
}

/* ------------------------------ Admins ------------------------------ */

export type ClipperReview = { userId: string; name: string; bio: string; link: string | null; imageUrl: string | null; status: ClipperStatus; reviewedBy: string | null; updatedAt: number };

/** Every entry, those waiting first, then the latest changes. */
export async function clipperQueue(): Promise<ClipperReview[]> {
  const rows = await db()<(Row & { reviewed_by: string | null; updated_at: number })[]>`
    select user_id, name, bio, link, image_url, status, reviewed_by, updated_at::float8 as updated_at
    from clipper_profiles
    order by (status = 'pending') desc, updated_at desc
    limit 300`;
  return rows.map((r) => ({ userId: r.user_id, name: r.name, bio: r.bio, link: r.link, imageUrl: r.image_url, status: r.status, reviewedBy: r.reviewed_by, updatedAt: r.updated_at }));
}

export async function clipperCounts(): Promise<{ pending: number; approved: number }> {
  const [row] = await db()<{ pending: number; approved: number }[]>`
    select count(*) filter (where status = 'pending')::int as pending, count(*) filter (where status = 'approved')::int as approved from clipper_profiles`;
  return row ?? { pending: 0, approved: 0 };
}

/**
 * Approve an entry (it's public at once, and its owner is emailed, once per approval) or hide
 * it (taken off the page; its owner can change it and ask again). Logged.
 */
export async function reviewClipper(admin: Admin, userId: string, action: "approve" | "hide", now = Date.now()): Promise<void> {
  const { logAdminAction } = await import("@/lib/server/admin");
  const sql = db();
  const status: ClipperStatus = action === "approve" ? "approved" : "hidden";
  const [row] = await sql<{ name: string; was: ClipperStatus }[]>`
    with before as (select status from clipper_profiles where user_id = ${userId})
    update clipper_profiles set status = ${status}, reviewed_by = ${admin.email}, approved_at = ${action === "approve" ? now : null}, updated_at = ${now}
    where user_id = ${userId}
    returning name, (select status from before) as was`;
  if (!row) throw new HttpError(404, "not_found", "That person isn’t asking to be listed any more.");
  forgetClippers();
  if (action === "approve" && row.was !== "approved") await queueEmail(userId, `clipper-approved:${now}`, { template: "clipper-approved", name: row.name });
  await logAdminAction(admin, `clipper.${action}`, userId, { name: row.name });
}
