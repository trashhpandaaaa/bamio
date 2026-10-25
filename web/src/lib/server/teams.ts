import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { z } from "zod";
import { db, type Tx } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";

/*
 * The Team plan's members: up to five people who work in their own accounts, on their own
 * projects, drawing on the owner's minutes (plans.ts, "Up to 5 team members").
 *
 * A team is not shared storage. Nothing about projects, media or clips is pooled, which keeps
 * every key, path and permission check in the app exactly as it was: a member's projects are
 * theirs, under their own media prefix, and the owner never sees them. What is shared is the
 * plan: what a member imports counts against the owner's month (lib/server/billing.ts reads
 * `teamOwner` for both the plan and where the minutes are counted).
 *
 * An owner invites an address, which writes a row before that person has an account; the row
 * is claimed when they sign in (Clerk's user.created webhook) or when they open Plan & billing.
 * An account belongs to one team at most, which a unique index enforces, so a member's plan is
 * never ambiguous.
 */

export const TEAM_SEATS = 5;

export const inviteSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter an email address.").max(200) });
export const removeMemberSchema = z.object({ email: z.string().trim().toLowerCase().max(200) });

export type TeamMember = { email: string; userId: string | null; invitedAt: number; joinedAt: number | null };

type Row = { email: string; member_user_id: string | null; invited_at: number; joined_at: number | null };
const toMember = (r: Row): TeamMember => ({ email: r.email, userId: r.member_user_id, invitedAt: r.invited_at, joinedAt: r.joined_at });

/** The team a member belongs to (the owner's user id), or null. Owners aren't members of their own team. */
export async function teamOwner(userId: string): Promise<string | null> {
  const [row] = await db()<{ owner_user_id: string }[]>`
    select owner_user_id from team_members where member_user_id = ${userId} and joined_at is not null`;
  return row?.owner_user_id ?? null;
}

/** Everyone on the owner's team, those who have joined first. */
export async function teamMembers(ownerId: string): Promise<TeamMember[]> {
  const rows = await db()<Row[]>`
    select email, member_user_id, invited_at::float8 as invited_at, joined_at::float8 as joined_at
    from team_members where owner_user_id = ${ownerId} order by joined_at nulls last, invited_at`;
  return rows.map(toMember);
}

/** Invite an address. The seat is taken from the moment it is invited, so five invites fill a team. */
export async function inviteMember(ownerId: string, email: string): Promise<TeamMember[]> {
  const address = email.trim().toLowerCase();
  if (!address) throw new HttpError(400, "bad_request", "Enter an email address.");
  return db().begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${`team:${ownerId}`}))`;
    const [{ count } = { count: 0 }] = await tx<{ count: number }[]>`select count(*)::int as count from team_members where owner_user_id = ${ownerId}`;
    const [existing] = await tx`select 1 from team_members where owner_user_id = ${ownerId} and email = ${address}`;
    if (existing) throw new HttpError(409, "already_invited", "That address is already on your team.");
    if (count >= TEAM_SEATS) throw new HttpError(409, "team_full", `A team holds ${TEAM_SEATS} members. Remove one to invite someone else.`);
    await tx`insert into team_members (owner_user_id, email, invited_at) values (${ownerId}, ${address}, ${Date.now()})`;
    return listInTx(tx, ownerId);
  });
}

export async function removeMember(ownerId: string, email: string): Promise<TeamMember[]> {
  await db()`delete from team_members where owner_user_id = ${ownerId} and email = ${email.trim().toLowerCase()}`;
  return teamMembers(ownerId);
}

async function listInTx(tx: Tx, ownerId: string): Promise<TeamMember[]> {
  const rows = await tx<Row[]>`
    select email, member_user_id, invited_at::float8 as invited_at, joined_at::float8 as joined_at
    from team_members where owner_user_id = ${ownerId} order by joined_at nulls last, invited_at`;
  return rows.map(toMember);
}

/**
 * Link a signed-in account to any seat invited to one of its addresses. Safe to call again
 * (and on every visit to Plan & billing): a claimed seat stays with the account that claimed
 * it, and an account already on a team claims nothing more.
 */
export async function claimSeat(userId: string, emails: string[]): Promise<string | null> {
  const addresses = emails.map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (addresses.length === 0) return null;
  return db().begin(async (tx) => {
    const [mine] = await tx<{ owner_user_id: string }[]>`select owner_user_id from team_members where member_user_id = ${userId}`;
    if (mine) return mine.owner_user_id;
    // An owner can't sit on their own team, and a seat already taken isn't offered again.
    const [row] = await tx<{ owner_user_id: string; email: string }[]>`
      select owner_user_id, email from team_members
      where email = any(${addresses}) and member_user_id is null and owner_user_id <> ${userId}
      order by invited_at limit 1`;
    if (!row) return null;
    await tx`update team_members set member_user_id = ${userId}, joined_at = ${Date.now()}
             where owner_user_id = ${row.owner_user_id} and email = ${row.email} and member_user_id is null`;
    return row.owner_user_id;
  });
}

/** Claim a seat for a signed-in user, asking Clerk for their verified addresses. */
export async function claimSeatFor(userId: string): Promise<string | null> {
  const emails = await verifiedEmails(userId).catch(() => []);
  return emails.length > 0 ? claimSeat(userId, emails) : null;
}

/** Every verified address on the Clerk account (a seat may be invited to any of them). */
async function verifiedEmails(userId: string): Promise<string[]> {
  const user = await (await clerkClient()).users.getUser(userId);
  return user.emailAddresses.filter((e) => e.verification?.status === "verified").map((e) => e.emailAddress.toLowerCase());
}

/** Every row about a user, for account deletion: their own team, and the seat they sit in. */
export async function deleteTeamRows(tx: Tx, userId: string) {
  await tx`delete from team_members where owner_user_id = ${userId}`;
  await tx`delete from team_members where member_user_id = ${userId}`;
}
