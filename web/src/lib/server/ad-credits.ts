import "server-only";
import { randomUUID } from "node:crypto";
import { AD_DAILY_CAP_SEC, AD_REWARD_SEC, AD_VIEW_MAX_MS, AD_VIEW_MIN_MS, adsEnabled, earnedMinutes, type AdCreditState, type AdView } from "@/lib/ads";
import { HttpError } from "@/lib/server/http";
import { addAdCredit, adCreditsEarnedSince, adCreditsLeft, claimAdView, openAdView, sweepAdViews } from "@/lib/server/store";

/*
 * AI minutes earned by watching ads. Any signed-in account can earn them, with no plan and no
 * card, and spends them on the same work a plan pays for once its own minutes for the period
 * are gone (recordUsage in billing.ts does the spending; assertCanProcess counts them as time
 * left). The balance is the ad_credits ledger, summed.
 *
 * What a server can and cannot know: the ad network resolves nothing a server can verify, so a
 * page saying "I watched it" is not evidence. A view is offered here, claimed no sooner than
 * AD_VIEW_MIN_MS later and once only, and the account's earnings for the day are capped. The
 * cap is the real protection: treat AD_DAILY_CAP_SEC as the most a determined account can mint
 * by calling /api/ads/reward in a loop, and keep it worth less than the processing it buys.
 */

/** Midnight UTC of the day `now` falls in: the day the cap is counted over. */
export function startOfDay(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The balance, today's earnings against the cap, and what one view is worth. */
export async function adCreditState(userId: string, now = Date.now()): Promise<AdCreditState> {
  const [leftSec, earnedTodaySec] = await Promise.all([adCreditsLeft(userId), adCreditsEarnedSince(userId, startOfDay(now))]);
  return { leftSec, earnedTodaySec, dailyCapSec: AD_DAILY_CAP_SEC, rewardSec: AD_REWARD_SEC, watchMs: AD_VIEW_MIN_MS, enabled: adsEnabled() };
}

const CAPPED = `You’ve earned today’s ${earnedMinutes(AD_DAILY_CAP_SEC)} minutes. More tomorrow, or choose a plan for minutes every month.`;

/** True once the account has earned all it may today. */
async function capped(userId: string, now: number): Promise<boolean> {
  return (await adCreditsEarnedSince(userId, startOfDay(now))) + AD_REWARD_SEC > AD_DAILY_CAP_SEC;
}

/**
 * Offer an ad view for the page to show. Refused where ads are off (there is nothing to watch)
 * or once the day's cap is reached, so a page never shows an ad it can't pay for.
 */
export async function startAdView(userId: string, now = Date.now()): Promise<AdView> {
  if (!adsEnabled()) throw new HttpError(503, "ads_off", "Ads aren’t running on this server, so there are no minutes to earn here.");
  if (await capped(userId, now)) throw new HttpError(429, "ads_capped", CAPPED);
  // Views too old to claim are of no use to anyone; clearing them here keeps the table to what's in flight.
  await sweepAdViews(now - AD_VIEW_MAX_MS).catch(() => undefined);
  const id = randomUUID();
  await openAdView(userId, id, now);
  return { id, watchMs: AD_VIEW_MIN_MS, rewardSec: AD_REWARD_SEC };
}

/**
 * Claim a view that has been showing long enough, and earn its seconds. The ledger row is keyed
 * by the view, so sending the claim twice earns once; the cap is checked again here, because
 * views can be offered faster than they are claimed.
 */
export async function claimReward(userId: string, id: string, now = Date.now()): Promise<AdCreditState> {
  if (!adsEnabled()) throw new HttpError(503, "ads_off", "Ads aren’t running on this server, so there are no minutes to earn here.");
  // Checked before the view is marked claimed, so reaching the cap mid-ad doesn't burn it.
  if (await capped(userId, now)) throw new HttpError(429, "ads_capped", CAPPED);
  const view = await claimAdView(userId, id, { minMs: AD_VIEW_MIN_MS, maxMs: AD_VIEW_MAX_MS, now });
  if (!view) throw new HttpError(409, "ad_not_watched", "That ad wasn’t counted. Let it play, then try again.");
  await addAdCredit(userId, `ad:${id}`, AD_REWARD_SEC, now);
  return adCreditState(userId, now);
}

/**
 * Take `sec` of earned time off the balance for `key` (the usage it pays for), never more than
 * is there. Keyed, so usage counted again after a crash is only ever paid for once. Returns
 * what was actually spent.
 */
export async function spendAdCredits(userId: string, key: string, sec: number, now = Date.now()): Promise<number> {
  if (!(sec > 0)) return 0;
  const spend = Math.min(await adCreditsLeft(userId), Math.round(sec * 10) / 10);
  if (!(spend > 0)) return 0;
  return (await addAdCredit(userId, `spend:${key}`, -spend, now)) ? spend : 0;
}
