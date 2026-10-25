import { z } from "zod";

/*
 * Ads, and the AI minutes people earn by watching them.
 *
 * The publisher's tag is in the head of every page (app/layout.tsx), as the network gives it:
 * an inline loader that injects its own script. Which pages show ads, and in which formats, is
 * set in the ad network's account, not here. The privacy page says ads are shown, names the
 * host that serves them, says what its cookies do and how to opt out: keep that true.
 *
 * It replaced Google AdSense (the user's decision, 2026-10-25). AdSense forbids giving people
 * anything for watching an ad, which is exactly what the earned minutes below do, and running a
 * second network beside it risks the AdSense account. So there is one network now, and nothing
 * here, in public/ads.txt or on the privacy page may claim AdSense again.
 */

/** The host the tag loads from. The privacy page names it, so people can see who serves the ads. */
export const AD_NETWORK_HOST = "fond-appointment.com";

/**
 * The tag exactly as the network gives it. It reads `settings` off its own <script> element
 * (document.currentScript), so it has to stay an inline script in the HTML, not a src on one.
 * Don't tidy it: the only change from the network's copy is that its `\/` escapes are written
 * as plain slashes, which is the same string to any JavaScript engine.
 */
export const AD_TAG = `(function(djjcyf){
var d = document,
    s = d.createElement('script'),
    l = d.currentScript || d.scripts[d.scripts.length - 1];
s.settings = djjcyf || {};
s.src = "//${AD_NETWORK_HOST}/bGXBVes.d/GQli0YYHWdcB/se/mJ9/u/ZkU_ljkrP-T/c/1cNHTHEwzfNfjFk/tSNKzGUS1LM/TmM_3CMKwg";
s.async = true;
s.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(s, l);
})({})`;

/**
 * Off on test servers and CI (BAMIO_ADS=off, at build and at start: static pages keep what the
 * build saw), so the test suite never calls the network and never counts as a visit. With ads
 * off there is nothing to watch, so no minutes can be earned either.
 */
export const adsEnabled = () => process.env.BAMIO_ADS !== "off";

/* ------------------------------ Earned AI minutes ------------------------------ */

/*
 * Watching an ad earns AI seconds, which any signed-in account may spend on the same work a
 * plan pays for (the user's decision, 2026-10-25): no plan and no card needed. Earned seconds
 * are a balance in the ad_credits ledger, spent only once the account's plan or free-trial
 * minutes for the period are gone (lib/server/ad-credits.ts, recordUsage in billing.ts).
 *
 * A browser cannot prove it showed an ad: this network resolves nothing a server can check, so
 * the page asking for minutes is not evidence. AD_DAILY_CAP_SEC is therefore the real limit,
 * not the ad view. Keep it worth less per day than the processing it buys, and read it as the
 * most a determined account can mint by calling /api/ads/reward in a loop.
 */

/** AI seconds one watched ad is worth. */
export const AD_REWARD_SEC = 30;

/** The most one account can earn in a UTC day, in seconds. The cap, not the ad, is what holds. */
export const AD_DAILY_CAP_SEC = 600;

/** An offered view counts only once this long has passed, and can no longer be claimed after AD_VIEW_MAX_MS. */
export const AD_VIEW_MIN_MS = 15_000;
export const AD_VIEW_MAX_MS = 10 * 60_000;

/** What /api/ads/reward tells the pages: the balance, today's earnings against the cap, and the terms of one view. */
export type AdCreditState = {
  /** AI seconds earned and not yet spent. */
  leftSec: number;
  earnedTodaySec: number;
  dailyCapSec: number;
  /** What the next view is worth, and how long it has to be watched for. */
  rewardSec: number;
  watchMs: number;
  /** False where ads are off on this server: there is nothing to watch. */
  enabled: boolean;
};

/** An offered ad view: watch it, then claim it by its id. */
export type AdView = { id: string; watchMs: number; rewardSec: number };

export const adRewardSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }),
  z.object({ action: z.literal("claim"), id: z.uuid() }),
]);

/** Whole minutes of earned time, for people: rounded down, so it never promises more than it holds. */
export const earnedMinutes = (sec: number) => Math.max(0, Math.floor(sec / 60 + 1e-6));
