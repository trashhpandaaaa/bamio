import "server-only";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { clerkClient } from "@clerk/nextjs/server";
import { closeBilling } from "@/lib/server/billing";
import { db } from "@/lib/server/db";
import { reportError } from "@/lib/server/monitor";
import { storage } from "@/lib/server/storage";
import { isUserId, scratch, userMediaPrefix } from "@/lib/server/store";
import { releaseTrialCard } from "@/lib/server/trial-cards";

/*
 * Deleting an account. A request is a row in account_deletions: from the profile's Delete
 * account (requestAccountDeletion, then the Clerk user is deleted at once, ending the session),
 * or from Clerk's user.deleted webhook (an account deleted in Clerk's dashboard). The workers'
 * sweeper (startAccountSweeper, started with the job worker) does the work, and again after a
 * crash or an error, each step safe to repeat:
 *   1. Stripe: subscriptions ended at once and the customer deleted, so nothing charges again.
 *   2. The user's running jobs stopped.
 *   3. Their media (storage) and work in progress (scratch folders) removed.
 *   4. Every row about them: projects (with transcripts and jobs), billing, usage, free plans,
 *      referrals, emails, admin role, and in campaigns their clipper details, memberships,
 *      clips and requests to run one (a campaign already made from a request stays). Payments recorded to them keep only the amount (it was spent from a campaign's
 *      budget), no longer tied to anyone. So does the card their free trial was started with:
 *      only Stripe's fingerprint of it stays, so the card can't start another trial.
 *   5. The Clerk user, if still there.
 * The row stays, holding only the user's id, as the record that the account was deleted.
 */

export type DeletionReason = "self" | "clerk" | "admin";

const CHANNEL = "bamio_account_deletions";
const LEASE_MS = 10 * 60_000;

export type AccountDeps = {
  closeBilling: (userId: string) => Promise<void>;
  /** Stop a project's running jobs and wait briefly for them to let go of its files. */
  stopProject: (projectId: string) => Promise<void>;
  /** Delete the Clerk user; nothing when it's already gone. */
  deleteClerkUser: (userId: string) => Promise<void>;
};

export const defaultAccountDeps: AccountDeps = {
  closeBilling,
  stopProject: async (projectId) => (await import("@/lib/server/jobs")).stopProject(projectId),
  deleteClerkUser: async (userId) => {
    try {
      await (await clerkClient()).users.deleteUser(userId);
    } catch (err) {
      if ((err as { status?: number }).status !== 404) throw err;
    }
  },
};

/** Ask for an account to be deleted. Once per user: asking again changes nothing. */
export async function requestAccountDeletion(userId: string, reason: DeletionReason, now = Date.now()): Promise<void> {
  if (!isUserId(userId)) return;
  const sql = db();
  await sql`insert into account_deletions (user_id, reason, run_after, requested_at) values (${userId}, ${reason}, ${now}, ${now})
    on conflict (user_id) do nothing`;
  await sql`select pg_notify(${CHANNEL}, '')`;
}

/** Steps 1 to 5 above for one user. Safe to run again. */
export async function deleteAccountData(userId: string, deps: AccountDeps = defaultAccountDeps): Promise<void> {
  if (!isUserId(userId)) return;
  const sql = db();
  await deps.closeBilling(userId);
  const projects = await sql<{ id: string }[]>`select id from projects where user_id = ${userId}`;
  for (const p of projects) await deps.stopProject(p.id);
  await storage().removePrefix(userMediaPrefix(userId));
  for (const p of projects) await rm(scratch(p.id).dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  await sql.begin(async (tx) => {
    await tx`delete from projects where user_id = ${userId}`;
    await tx`delete from jobs where user_id = ${userId}`;
    await tx`delete from billing_accounts where user_id = ${userId}`;
    await tx`delete from usage_entries where user_id = ${userId}`;
    await tx`delete from plan_grants where user_id = ${userId}`;
    await tx`delete from referrals where referrer_user_id = ${userId} or referred_user_id = ${userId}`;
    await tx`delete from referral_codes where user_id = ${userId}`;
    await tx`delete from emails where user_id = ${userId}`;
    await tx`delete from admins where user_id = ${userId}`;
    await tx`delete from campaign_requests where user_id = ${userId}`;
    await tx`delete from campaign_clips where user_id = ${userId}`;
    await tx`delete from campaign_members where user_id = ${userId}`;
    await tx`update campaign_payouts set user_id = null, note = '' where user_id = ${userId}`;
    await tx`delete from clippers where user_id = ${userId}`;
    // Their files went with the rest of the account's media, above.
    await tx`delete from downloads where user_id = ${userId}`;
    await releaseTrialCard(userId, tx);
  });
  await deps.deleteClerkUser(userId);
}

/** Retries wait longer each time: 1, 2, 4... minutes, at most 6 hours. */
const retryDelay = (attempts: number) => Math.min(6 * 3600_000, 60_000 * 2 ** Math.max(0, attempts - 1));

/** Claim the next due deletion and do it. False when none is due. */
export async function deleteNextAccount(deps: AccountDeps = defaultAccountDeps, log: (m: string) => void = console.log, now = Date.now()): Promise<boolean> {
  const sql = db();
  const [row] = await sql<{ user_id: string; attempts: number }[]>`
    update account_deletions set status = 'working', attempts = attempts + 1, lease_until = ${now + LEASE_MS}
    where user_id = (
      select user_id from account_deletions
      where (status = 'queued' and run_after <= ${now}) or (status = 'working' and lease_until < ${now})
      order by run_after
      limit 1
      for update skip locked
    )
    returning user_id, attempts`;
  if (!row) return false;
  try {
    await deleteAccountData(row.user_id, deps);
    await sql`update account_deletions set status = 'done', done_at = ${Date.now()}, lease_until = null, last_error = null where user_id = ${row.user_id}`;
    log(`[bamio/accounts] deleted account ${row.user_id}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`[bamio/accounts] deleting account ${row.user_id} failed (attempt ${row.attempts}), trying again later: ${message}`);
    reportError(err, "account deletion failed", { userId: row.user_id, attempts: row.attempts });
    await sql`update account_deletions set status = 'queued', lease_until = null, last_error = ${message.slice(0, 1000)},
      run_after = ${Date.now() + retryDelay(row.attempts)} where user_id = ${row.user_id}`;
  }
  return true;
}

export type AccountSweeper = { stop: () => Promise<void> };

/** Works through account deletions as they're asked for (and every minute, for retries and lost leases). */
export function startAccountSweeper(deps: AccountDeps = defaultAccountDeps, opts: { pollMs?: number; log?: (m: string) => void } = {}): AccountSweeper {
  const log = opts.log ?? ((m: string) => console.log(m));
  const id = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  let stopping = false;
  let running: Promise<void> | null = null;
  let again = false;
  let quietUntil = 0;

  function kick() {
    if (stopping) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        try {
          while (!stopping && (await deleteNextAccount(deps, log))) {
            // Next one.
          }
        } catch (err) {
          if (Date.now() >= quietUntil) {
            log(`[bamio/accounts] ${id} can't delete accounts: ${err instanceof Error ? err.message : String(err)}`);
            quietUntil = Date.now() + 60_000;
          }
        }
      } while (again && !stopping);
    })().finally(() => {
      running = null;
    });
  }

  const listening = db()
    .listen(CHANNEL, () => kick())
    .catch(() => null);
  const poll = setInterval(kick, opts.pollMs ?? 60_000);
  kick();
  return {
    async stop() {
      stopping = true;
      clearInterval(poll);
      await (await listening)?.unlisten().catch(() => undefined);
      await running;
    },
  };
}
