import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { REFERRAL_REWARD_CENTS } from "@/lib/billing/plans";
import { creditReferrer, referralState, settleReferral, type ReferralDeps } from "@/lib/server/billing";
import { db } from "@/lib/server/db";
import { codeOwner, isReferralCode, recordReferral, referralCode } from "@/lib/server/referrals";

const ALICE = "user_ref_alice"; // shares her link
const BOB = "user_ref_bob"; // subscribes through it
const CARL = "user_ref_carl";
const USERS = [ALICE, BOB, CARL];

/** A fake Stripe: which customers have paid, and the credits it was asked for. */
function fakeStripe(paid: Record<string, string> = {}) {
  const credits: { customer: string; cents: number; key: string }[] = [];
  const deps: ReferralDeps = {
    paidInvoice: async (customer) => (paid[customer] ? { id: paid[customer]! } : null),
    credit: async (customer, cents, key) => {
      credits.push({ customer, cents, key });
      return `cbtxn_${credits.length}`;
    },
  };
  return { deps, credits, paid };
}

const customer = (userId: string) => db()`
  insert into billing_accounts (user_id, data, updated_at) values (${userId}, ${db().json({ customerId: `cus_${userId}` })}, ${Date.now()})
  on conflict (user_id) do update set data = excluded.data`;

const emails = (userId: string) => db()<{ key: string; data: { onBalance: boolean; amountCents: number } }[]>`select key, data from emails where user_id = ${userId} order by id`;

describe("referrals", () => {
  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    process.env.BAMIO_EMAIL = "preview";
    for (const u of USERS) {
      await db()`delete from referrals where referred_user_id = ${u} or referrer_user_id = ${u}`;
      await db()`delete from referral_codes where user_id = ${u}`;
      await db()`delete from billing_accounts where user_id = ${u}`;
      await db()`delete from emails where user_id = ${u}`;
    }
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.BAMIO_EMAIL;
  });
  afterAll(async () => {
    await db()`delete from referrals`;
    await db()`delete from referral_codes`;
  });

  it("give every user one short, readable code", async () => {
    const code = await referralCode(ALICE);
    expect(isReferralCode(code)).toBe(true);
    expect(code).toMatch(/^[2-9a-z]{8}$/);
    expect(code).not.toMatch(/[01ilo]/);
    expect(await referralCode(ALICE)).toBe(code);
    expect(await codeOwner(code)).toBe(ALICE);
    expect(await codeOwner("zzzzzzzz")).toBeNull();
    expect(isReferralCode("../etc")).toBe(false);
  });

  it("are recorded once, for a first plan, never with your own link", async () => {
    const code = await referralCode(ALICE);
    expect(await recordReferral(ALICE, code, { newSubscriber: true })).toBe(false); // her own link
    expect(await recordReferral(BOB, "zzzzzzzz", { newSubscriber: true })).toBe(false); // unknown code
    expect(await recordReferral(BOB, code, { newSubscriber: false })).toBe(false); // had a plan before
    expect(await recordReferral(BOB, code, { newSubscriber: true })).toBe(true);
    const carls = await referralCode(CARL);
    expect(await recordReferral(BOB, carls, { newSubscriber: true })).toBe(false); // already referred by Alice
    expect((await referralState(ALICE, "https://bamio.app")).pending).toBe(1);
  });

  it("earn the referrer credit once, when the friend's first real payment goes through", async () => {
    await recordReferral(BOB, await referralCode(ALICE), { newSubscriber: true });
    await customer(ALICE);
    await customer(BOB);
    const stripe = fakeStripe();

    // Subscribed with a 100%-off code (or not paid yet): nothing.
    await settleReferral(BOB, stripe.deps);
    expect(stripe.credits).toHaveLength(0);
    expect(await emails(ALICE)).toHaveLength(0);

    // Paid: Alice gets the credit on her balance, and an email.
    stripe.paid[`cus_${BOB}`] = "in_bob_1";
    await settleReferral(BOB, stripe.deps);
    await settleReferral(BOB, stripe.deps); // the webhook and a refresh both see it
    expect(stripe.credits).toEqual([{ customer: `cus_${ALICE}`, cents: REFERRAL_REWARD_CENTS, key: `bamio-referral-${BOB}` }]);
    expect(await emails(ALICE)).toEqual([{ key: `referral-earned:${BOB}`, data: expect.objectContaining({ amountCents: 500, onBalance: true }) }]);
    const state = await referralState(ALICE, "https://bamio.app");
    expect(state).toMatchObject({ pending: 0, rewarded: 1, earnedCents: 500, waitingCents: 0 });
    expect(state.link).toMatch(/^https:\/\/bamio\.app\/r\/[2-9a-z]{8}$/);
    const [row] = await db()<{ status: string; invoice_id: string; balance_txn_id: string }[]>`select status, invoice_id, balance_txn_id from referrals where referred_user_id = ${BOB}`;
    expect(row).toEqual({ status: "credited", invoice_id: "in_bob_1", balance_txn_id: "cbtxn_1" });
  });

  it("keep the credit for a referrer without a plan until their first checkout", async () => {
    await recordReferral(BOB, await referralCode(ALICE), { newSubscriber: true });
    await customer(BOB);
    const stripe = fakeStripe({ [`cus_${BOB}`]: "in_bob_1" });
    await settleReferral(BOB, stripe.deps);
    expect(stripe.credits).toHaveLength(0);
    expect((await emails(ALICE))[0]?.data).toMatchObject({ onBalance: false });
    expect(await referralState(ALICE, "https://bamio.app")).toMatchObject({ rewarded: 1, earnedCents: 500, waitingCents: 500 });

    // Her first checkout makes her a Stripe customer: the credit goes on.
    await customer(ALICE);
    await creditReferrer(ALICE, stripe.deps);
    expect(stripe.credits).toEqual([{ customer: `cus_${ALICE}`, cents: 500, key: `bamio-referral-${BOB}` }]);
    expect(await referralState(ALICE, "https://bamio.app")).toMatchObject({ waitingCents: 0, earnedCents: 500 });
  });

  it("do nothing with plans off", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await recordReferral(BOB, await referralCode(ALICE), { newSubscriber: true });
    await customer(ALICE);
    await customer(BOB);
    const stripe = fakeStripe({ [`cus_${BOB}`]: "in_bob_1" });
    await settleReferral(BOB, stripe.deps);
    expect(stripe.credits).toHaveLength(0);
  });
});
