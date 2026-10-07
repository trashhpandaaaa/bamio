import "server-only";
import { db, type Sql, type Tx } from "@/lib/server/db";

/*
 * The free trial's card. The free first video needs a card on file (checked by Stripe, never
 * charged), and a card starts one trial only: what's kept is Stripe's fingerprint of the card,
 * the same for the same card number whichever account adds it, with the brand and last four
 * digits for the account's own pages. billing.ts does the Stripe side (it reads the Stripe key,
 * this doesn't). When an account is deleted its row keeps only the fingerprint, so the same
 * card can't start another trial on a new account.
 */

export type TrialCard = { brand: string; last4: string };

const USER_ID = /^[A-Za-z0-9_-]{1,80}$/;

/** The card the user's trial was started with, or null. */
export async function readTrialCard(userId: string): Promise<TrialCard | null> {
  if (!USER_ID.test(userId)) return null;
  const [row] = await db()<{ brand: string | null; last4: string | null }[]>`select brand, last4 from trial_cards where user_id = ${userId}`;
  return row ? { brand: row.brand ?? "card", last4: row.last4 ?? "" } : null;
}

/**
 * Tie a card to the user's trial. True when the user now has a card on record (this one, or
 * one they added before); false when this card already started a trial on another account
 * (a deleted one too). The table's two unique keys decide, so two accounts adding the same
 * card at once can't both win.
 */
export async function claimTrialCard(userId: string, card: { fingerprint: string } & TrialCard, now = Date.now()): Promise<boolean> {
  if (!USER_ID.test(userId)) return false;
  const sql = db();
  const added = await sql`
    insert into trial_cards (fingerprint, user_id, brand, last4, created_at) values (${card.fingerprint}, ${userId}, ${card.brand.slice(0, 30)}, ${card.last4.slice(0, 4)}, ${now})
    on conflict do nothing
    returning fingerprint`;
  if (added.length > 0) return true;
  const mine = await sql`select 1 from trial_cards where user_id = ${userId}`;
  return mine.length > 0;
}

/** For an account being deleted: the card's fingerprint stays, tied to nobody. */
export async function releaseTrialCard(userId: string, sql: Sql | Tx = db()): Promise<void> {
  await sql`update trial_cards set user_id = null, brand = null, last4 = null where user_id = ${userId}`;
}
