import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AD_DAILY_CAP_SEC, AD_REWARD_SEC, AD_VIEW_MIN_MS } from "@/lib/ads";
import { adCreditState, claimReward, spendAdCredits, startAdView, startOfDay } from "@/lib/server/ad-credits";
import { assertCanProcess, assertPlan, billingState, projectLimit, recordUsage, secondsLeft, type SubscriptionRecord } from "@/lib/server/billing";
import { db } from "@/lib/server/db";
import { claimTrialCard } from "@/lib/server/trial-cards";

/*
 * AI minutes earned by watching ads (src/lib/ads.ts, src/lib/server/ad-credits.ts): what a view
 * has to do to earn, the daily cap that is the real limit on it, and the one rule of spending,
 * that earned seconds pay only for what the account's own minutes couldn't.
 */

const USERS = ["user_ads_view", "user_ads_cap", "user_ads_noplan", "user_ads_plan", "user_ads_spend"];

/** Seconds on the balance, as a claimed view would have left them. */
const earn = (userId: string, sec: number, at = Date.now()) => db()`insert into ad_credits (user_id, key, sec, at) values (${userId}, ${`ad:${randomUUID()}`}, ${sec}, ${at})`;

/** A plan as a webhook would have saved it (read just now, so nothing asks Stripe). */
async function givePlan(userId: string, plan: "starter" | "pro") {
  const now = Date.now();
  const subscription: SubscriptionRecord = { id: `sub_${userId}`, status: "active", plan, interval: "month", anchor: now - 86400_000, periodEnd: now + 29 * 86400_000, cancelAt: null, checkedAt: now };
  const data = { customerId: `cus_${userId}`, subscription };
  await db()`insert into billing_accounts (user_id, data, updated_at) values (${userId}, ${db().json(data)}, ${now})
    on conflict (user_id) do update set data = excluded.data`;
}

async function clean() {
  const sql = db();
  for (const t of ["ad_credits", "ad_views", "usage_entries", "billing_accounts"]) await sql`delete from ${sql(t)} where user_id in ${sql(USERS)}`;
  await sql`delete from trial_cards where user_id in ${sql(USERS)} or fingerprint in ${sql(USERS.map((u) => `fp_${u}`))}`;
}

describe("earning AI minutes from ads", () => {
  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    delete process.env.BAMIO_ADS;
    await clean();
  });
  afterAll(async () => {
    await clean();
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("earn only for a view that was really showing, and only once", async () => {
    const user = "user_ads_view";
    const now = Date.now();
    const view = await startAdView(user, now);
    expect(view).toMatchObject({ rewardSec: AD_REWARD_SEC, watchMs: AD_VIEW_MIN_MS });

    // Claimed too soon: a page that skipped the ad earns nothing.
    await expect(claimReward(user, view.id, now + AD_VIEW_MIN_MS - 1_000)).rejects.toMatchObject({ status: 409, code: "ad_not_watched" });
    expect((await adCreditState(user, now)).leftSec).toBe(0);

    // Shown long enough: the seconds land.
    const after = now + AD_VIEW_MIN_MS + 500;
    expect(await claimReward(user, view.id, after)).toMatchObject({ leftSec: AD_REWARD_SEC, earnedTodaySec: AD_REWARD_SEC, dailyCapSec: AD_DAILY_CAP_SEC });

    // The same view again, and a made-up one, earn nothing.
    await expect(claimReward(user, view.id, after)).rejects.toMatchObject({ code: "ad_not_watched" });
    await expect(claimReward(user, randomUUID(), after)).rejects.toMatchObject({ code: "ad_not_watched" });
    expect((await adCreditState(user, after)).leftSec).toBe(AD_REWARD_SEC);

    // Ads off (test servers, CI): nothing to watch, so nothing to earn.
    process.env.BAMIO_ADS = "off";
    await expect(startAdView(user, after)).rejects.toMatchObject({ status: 503, code: "ads_off" });
    expect((await adCreditState(user, after)).enabled).toBe(false);
  });

  it("stop at the day’s cap, and offer again the next day", async () => {
    const user = "user_ads_cap";
    const now = Date.now();
    await earn(user, AD_DAILY_CAP_SEC, startOfDay(now) + 1_000);
    await expect(startAdView(user, now)).rejects.toMatchObject({ status: 429, code: "ads_capped" });

    // A view offered just under the cap can't be claimed past it either.
    const sneak = randomUUID();
    await db()`insert into ad_views (id, user_id, issued_at) values (${sneak}, ${user}, ${now - AD_VIEW_MIN_MS - 1_000})`;
    await expect(claimReward(user, sneak, now)).rejects.toMatchObject({ code: "ads_capped" });
    expect((await adCreditState(user, now)).leftSec).toBe(AD_DAILY_CAP_SEC);

    // Tomorrow the day's count starts again.
    const tomorrow = startOfDay(now) + 86_400_000 + 1_000;
    expect(await startAdView(user, tomorrow)).toMatchObject({ rewardSec: AD_REWARD_SEC });
    expect((await adCreditState(user, tomorrow)).earnedTodaySec).toBe(0);
  });

  it("pay for AI without a plan or a card, and leave the free video’s own minutes alone", async () => {
    const user = "user_ads_noplan";
    await earn(user, 120);
    // The trial's 8 minutes plus what was earned (the trial still needs its card before it counts).
    expect(await secondsLeft(user)).toBe(8 * 60 + 120);
    await expect(assertCanProcess(user, { sec: 100, source: "link" })).resolves.toBeUndefined();
    await expect(assertPlan(user)).resolves.toBeUndefined();
    expect(await projectLimit(user)).toBe(1);

    // With no card there are no trial minutes to spend, so all of this comes off the balance.
    await recordUsage(user, "p1", 100);
    expect((await adCreditState(user)).leftSec).toBe(20);
    expect((await billingState(user)).trial).toEqual({ usedSec: 0, allowanceSec: 480, card: null });

    // Down to 20 seconds: not enough to start anything, and the card is still what the free video needs.
    await expect(assertCanProcess(user)).rejects.toMatchObject({ status: 402, code: "card_required" });

    // Once the card is on file the free video is untouched, and it pays before the earned seconds do.
    expect(await claimTrialCard(user, { fingerprint: `fp_${user}`, brand: "visa", last4: "4242" })).toBe(true);
    expect(await secondsLeft(user)).toBe(480 + 20);
    await recordUsage(user, "p2", 480);
    expect((await billingState(user)).trial).toMatchObject({ usedSec: 480 });
    expect((await adCreditState(user)).leftSec).toBe(20);
  });

  it("spend earned seconds only for what the plan’s own minutes couldn’t cover", async () => {
    const user = "user_ads_plan";
    await givePlan(user, "starter"); // 150 minutes a month
    await earn(user, 600);
    expect(await secondsLeft(user)).toBe(150 * 60 + 600);

    // Inside the plan: nothing comes off the balance.
    await recordUsage(user, "a", 8_900);
    expect((await adCreditState(user)).leftSec).toBe(600);

    // Over it: the plan pays its last 100 seconds, the balance pays the other 200.
    await recordUsage(user, "b", 300);
    expect((await adCreditState(user)).leftSec).toBe(400);
    expect((await billingState(user)).usage).toMatchObject({ usedSec: 150 * 60, allowanceSec: 150 * 60 });

    // The same work counted again after a crash is paid for once.
    await recordUsage(user, "b", 300);
    expect((await adCreditState(user)).leftSec).toBe(400);

    // The month's minutes are gone, but the earned ones still let a short video through.
    await expect(assertCanProcess(user, { sec: 300, source: "link" })).resolves.toBeUndefined();
    // Enough more work to empty the balance too, and then there's nothing left to start with.
    await recordUsage(user, "c", 400);
    expect((await adCreditState(user)).leftSec).toBe(0);
    await expect(assertCanProcess(user)).rejects.toMatchObject({ status: 402, code: "minutes_used" });
  });

  it("never spend more than the balance holds", async () => {
    const user = "user_ads_spend";
    await earn(user, 90);
    expect(await spendAdCredits(user, "job-1", 10_000)).toBe(90);
    expect((await adCreditState(user)).leftSec).toBe(0);
    // Asked again for the same work: nothing more comes off.
    expect(await spendAdCredits(user, "job-1", 10_000)).toBe(0);
    expect((await adCreditState(user)).leftSec).toBe(0);
  });
});
