import "server-only";
import { randomInt } from "node:crypto";
import { db, type Tx } from "@/lib/server/db";
import { queueEmail } from "@/lib/server/email";

/*
 * Referral links: every user has a code (bamio.app/r/<code>). A visitor who arrives through
 * one keeps it in a cookie; when they first go to checkout, the referral is recorded (once per
 * user, never their own code, only for someone who has never had a plan). When their first
 * paid payment goes through, the referrer earns REFERRAL_REWARD_CENTS as credit on their
 * Bamio bill (billing.ts does the Stripe side: it reads the Stripe key, this doesn't).
 */

export const REFERRAL_COOKIE = "bamio_ref";
/** How long a link's visit counts: 60 days. */
export const REFERRAL_COOKIE_DAYS = 60;

// No 0/o, 1/l/i: codes are read aloud and typed.
const ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";
const CODE = /^[23456789abcdefghjkmnpqrstuvwxyz]{8}$/;
const USER_ID = /^[A-Za-z0-9_-]{1,80}$/;

export const isReferralCode = (code: unknown): code is string => typeof code === "string" && CODE.test(code);

const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");

/** The user's referral code, made the first time it's asked for. */
export async function referralCode(userId: string): Promise<string> {
  if (!USER_ID.test(userId)) throw new Error("Unknown user.");
  const sql = db();
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await sql<{ code: string }[]>`
      insert into referral_codes (user_id, code, created_at) values (${userId}, ${newCode()}, ${Date.now()})
      on conflict do nothing
      returning code`;
    if (row) return row.code;
    // The user already has one, or (rarely) the code was taken: read, else try another code.
    const [mine] = await sql<{ code: string }[]>`select code from referral_codes where user_id = ${userId}`;
    if (mine) return mine.code;
  }
  throw new Error("Couldn't make a referral code.");
}

/** Who a code belongs to, or null. */
export async function codeOwner(code: string): Promise<string | null> {
  if (!isReferralCode(code)) return null;
  const [row] = await db()<{ user_id: string }[]>`select user_id from referral_codes where code = ${code}`;
  return row?.user_id ?? null;
}

/**
 * Record that `userId` arrived through `code`, when they go to checkout. Only for someone who
 * has never had a plan (`newSubscriber`), never with their own code, and only the first time.
 * Returns true if it was recorded now.
 */
export async function recordReferral(userId: string, code: string, opts: { newSubscriber: boolean }): Promise<boolean> {
  if (!opts.newSubscriber || !USER_ID.test(userId)) return false;
  const referrer = await codeOwner(code);
  if (!referrer || referrer === userId) return false;
  const rows = await db()`
    insert into referrals (referred_user_id, referrer_user_id, code, created_at) values (${userId}, ${referrer}, ${code}, ${Date.now()})
    on conflict (referred_user_id) do nothing
    returning referred_user_id`;
  return rows.length > 0;
}

/** The user's referral, if it's still waiting for their first payment. */
export async function pendingReferral(userId: string): Promise<{ referrerUserId: string } | null> {
  const [row] = await db()<{ referrer_user_id: string }[]>`select referrer_user_id from referrals where referred_user_id = ${userId} and status = 'pending'`;
  return row ? { referrerUserId: row.referrer_user_id } : null;
}

/**
 * The referred user's first payment went through: the referral is earned (once), and the
 * referrer is emailed in the same transaction. `onBalance`: the credit goes straight onto the
 * referrer's Stripe balance (they have a Stripe customer); else it waits for their first
 * checkout. Returns the referrer, or null if it was already earned.
 */
export async function markEarned(referredUserId: string, invoiceId: string, cents: number, opts: { onBalance: boolean }): Promise<{ referrerUserId: string } | null> {
  return db().begin(async (tx: Tx) => {
    const [row] = await tx<{ referrer_user_id: string }[]>`
      update referrals set status = 'earned', reward_cents = ${cents}, invoice_id = ${invoiceId}, earned_at = ${Date.now()}
      where referred_user_id = ${referredUserId} and status = 'pending'
      returning referrer_user_id`;
    if (!row) return null;
    await queueEmail(row.referrer_user_id, `referral-earned:${referredUserId}`, { template: "referral-earned", amountCents: cents, onBalance: opts.onBalance }, tx);
    return { referrerUserId: row.referrer_user_id };
  }) as Promise<{ referrerUserId: string } | null>;
}

/** Rewards the referrer has earned that aren't on their Stripe balance yet. */
export async function owedRewards(referrerUserId: string): Promise<{ referredUserId: string; cents: number }[]> {
  const rows = await db()<{ referred_user_id: string; reward_cents: number }[]>`
    select referred_user_id, reward_cents from referrals where referrer_user_id = ${referrerUserId} and status = 'earned' order by earned_at`;
  return rows.map((r) => ({ referredUserId: r.referred_user_id, cents: r.reward_cents }));
}

/** A reward is on the referrer's Stripe balance now. */
export async function markCredited(referredUserId: string, balanceTxnId: string) {
  await db()`update referrals set status = 'credited', balance_txn_id = ${balanceTxnId}, credited_at = ${Date.now()}
    where referred_user_id = ${referredUserId} and status = 'earned'`;
}

/** What the referrer's link has done: friends waiting for their first payment, friends rewarded, and the money. */
export async function referralStats(referrerUserId: string): Promise<{ pending: number; rewarded: number; earnedCents: number; waitingCents: number }> {
  const [row] = await db()<{ pending: number; rewarded: number; earned: number; waiting: number }[]>`
    select count(*) filter (where status = 'pending')::int as pending,
           count(*) filter (where status in ('earned', 'credited'))::int as rewarded,
           coalesce(sum(reward_cents) filter (where status in ('earned', 'credited')), 0)::int as earned,
           coalesce(sum(reward_cents) filter (where status = 'earned'), 0)::int as waiting
    from referrals where referrer_user_id = ${referrerUserId}`;
  return { pending: row?.pending ?? 0, rewarded: row?.rewarded ?? 0, earnedCents: row?.earned ?? 0, waitingCents: row?.waiting ?? 0 };
}
