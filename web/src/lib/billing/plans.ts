import { z } from "zod";

/*
 * Bamio's plans, shared by the pricing page and the server: prices, what each plan includes,
 * and the limits the server enforces (AI processing minutes, projects kept, queue priority).
 *
 * Stripe holds the prices too (created by `npm run stripe:setup` with the lookup keys below);
 * the amounts here are for display and must match.
 *
 * `soon: true` marks a feature Bamio doesn't have yet: the pricing page lists it as coming
 * soon instead of included, so nobody pays for something that isn't there. Remove the flag
 * when the feature ships.
 */

export const PLAN_IDS = ["starter", "pro", "team"] as const;
export const INTERVALS = ["month", "quarter"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export type Interval = (typeof INTERVALS)[number];
export const planIdSchema = z.enum(PLAN_IDS);
export const intervalSchema = z.enum(INTERVALS);

/** `detail`: what the line means in Bamio, shown under it. */
export type Feature = { text: string; detail?: string; soon?: boolean };

export type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  /** In US cents: billed every month, or every 3 months. */
  price: Record<Interval, number>;
  /** AI processing minutes a month (minutes of video imported). */
  minutes: number;
  /** Projects kept at once. */
  projects: number;
  /** Place in the processing queue: higher goes first. */
  priority: number;
  popular?: boolean;
  /** The plan whose features this one includes ("Everything in Starter, plus:"). */
  includes?: PlanId;
  features: Feature[];
};

const soon = (text: string): Feature => ({ text, soon: true });

export const PLANS: Record<PlanId, Plan> = {
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "For individual creators getting started",
    price: { month: 1200, quarter: 3000 },
    minutes: 150,
    projects: 50,
    priority: 0,
    features: [
      { text: "150 AI processing minutes/month" },
      { text: "AI video clipping" },
      { text: "Automatic highlight detection" },
      { text: "Auto captions" },
      { text: "1080p export", detail: "Clips, and the video editor (which is free at 720p)" },
      { text: "No watermark" },
      { text: "Vertical, square and wide clips", detail: "9:16, 1:1 or 16:9; drag the picture to reframe" },
      { text: "Basic caption styles" },
      { text: "Captions in over 100 languages", detail: "Detected for you, with a time for every word" },
      { text: "Live stream capture", detail: "YouTube, Twitch and Kick: a part, or follow the whole stream" },
      { text: "Clipping campaigns", detail: "Join campaigns and earn for every 1,000 views on the clips you post" },
      { text: "1 user" },
      { text: "Basic storage", detail: "Keep up to 50 projects" },
      { text: "Standard processing speed" },
      { text: "Basic support" },
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "For serious creators, podcasters & influencers",
    price: { month: 2400, quarter: 6000 },
    minutes: 400,
    projects: 150,
    priority: 1,
    popular: true,
    includes: "starter",
    features: [
      { text: "400 AI processing minutes/month" },
      { text: "AI virality/quality scoring" },
      { text: "AI-generated titles" },
      { text: "Priority processing", detail: "Your videos go first in the queue" },
      { text: "Silence removal", detail: "In the editor: the pauses found and cut in one go" },
      { text: "60 fps export", detail: "In the editor: smoother gameplay and sport" },
      { text: "Music that ducks under speech", detail: "In the editor: quieter while someone talks, back up in the pauses" },
      soon("4K export"),
      soon("Filler-word removal"),
      soon("AI face tracking"),
      soon("Custom caption styling"),
      { text: "Extended storage", detail: "Keep up to 150 projects" },
      { text: "Commercial usage" },
      { text: "Priority support" },
    ],
  },
  team: {
    id: "team",
    name: "Team",
    tagline: "For agencies, businesses & content teams",
    price: { month: 5400, quarter: 14400 },
    minutes: 1000,
    projects: 400,
    priority: 1,
    includes: "pro",
    features: [
      { text: "1,000 AI processing minutes/month" },
      { text: "Priority processing", detail: "Your videos go first in the queue" },
      { text: "Increased storage", detail: "Keep up to 400 projects" },
      { text: "Commercial/client usage" },
      soon("Up to 5 team members"),
      { text: "Priority support" },
    ],
  },
};

/** Stripe price lookup keys, one per plan and billing period. */
export const lookupKey = (plan: PlanId, interval: Interval) => `bamio_${plan}_${interval}`;
export const ALL_LOOKUP_KEYS = PLAN_IDS.flatMap((plan) => INTERVALS.map((interval) => lookupKey(plan, interval)));

export function fromLookupKey(key: string | null | undefined): { plan: PlanId; interval: Interval } | null {
  const m = /^bamio_(starter|pro|team)_(month|quarter)$/.exec(key ?? "");
  return m ? { plan: m[1] as PlanId, interval: m[2] as Interval } : null;
}

/** How much the 3-month plan saves against paying monthly for 3 months, in cents. */
export const quarterSaving = (plan: Plan) => plan.price.month * 3 - plan.price.quarter;

/** "$12", "$30", "$144". */
export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * Trying Bamio without a plan: the first video free, up to this many minutes of it, once per
 * account (minutes counted over the account's whole life, not monthly), one project at a time.
 * It needs a card on file first (checked by Stripe, never charged), and a card starts one
 * trial only. Only with plans on; a paid or given plan replaces it.
 */
export const FREE_TRIAL = { minutes: 8, projects: 1 } as const;

/** What a referrer earns, once per friend whose first payment goes through: credit on their Bamio bill. */
export const REFERRAL_REWARD_CENTS = 500;

/** What /api/referrals tells the billing page: the user's link and what it has earned. */
export type ReferralState = {
  link: string;
  rewardCents: number;
  /** Friends who started subscribing through the link and haven't paid yet. */
  pending: number;
  /** Friends whose first payment went through. */
  rewarded: number;
  earnedCents: number;
  /** Earned, but not on a Stripe balance yet: the referrer has never had a plan. It's added at their first checkout. */
  waitingCents: number;
};

/** Subscription states that keep a plan working (past_due: Stripe is still retrying the payment). */
export const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

/** What /api/billing tells the pages about the signed-in user's plan. */
export type BillingState = {
  /** False when this server has no Stripe key: no plans to buy, and nothing is limited. */
  enabled: boolean;
  /** The plan works now (paid, or Stripe still retrying the payment). `plan` stays set after it ends. */
  active: boolean;
  plan: PlanId | null;
  interval: Interval | null;
  /** Stripe's subscription status: "active", "past_due", "canceled", ... */
  status: string | null;
  /** When the plan renews, or with `ending`, when it stops. */
  periodEnd: number | null;
  ending: boolean;
  /** AI processing this month, with a working plan. Seconds; the allowance is the plan's minutes. */
  usage: { usedSec: number; allowanceSec: number; resetsAt: number } | null;
  projects: { count: number; limit: number };
  /** Has a Stripe customer, so the billing portal can open (plan changes, card, invoices, cancelling). */
  canManage: boolean;
  /** The plan was given without paying (plan_grants), for good: no price or renewal. */
  granted: boolean;
  /**
   * Without a plan, for an account that never had one: the free first video's minutes
   * (FREE_TRIAL), used and given, and the card it was started with (null: one must be added first).
   */
  trial: { usedSec: number; allowanceSec: number; card: { brand: string; last4: string } | null } | null;
};

const CARD_BRANDS: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners Club", jcb: "JCB", unionpay: "UnionPay" };

/** "Visa ending 4242", from Stripe's name for the brand. */
export const cardLabel = (card: { brand: string; last4: string }) => `${CARD_BRANDS[card.brand] ?? "Card"}${card.last4 ? ` ending ${card.last4}` : ""}`;

/** Whole minutes for people: used rounds up, left rounds down. */
export const usedMinutes = (sec: number) => Math.max(0, Math.ceil(sec / 60 - 1e-6));
export const minutesLeft = (usage: NonNullable<BillingState["usage"]>) => Math.max(0, Math.floor((usage.allowanceSec - usage.usedSec) / 60 + 1e-6));

/**
 * The month of usage that `now` falls in. Minutes reset monthly on the day the subscription
 * started (also on 3-month plans: "150 minutes a month"), clamped to short months (a plan
 * started on the 31st resets on the 30th, or the 28th in February).
 */
export function usageWindow(anchorMs: number, nowMs: number): { start: number; end: number } {
  const anchor = new Date(anchorMs);
  const at = (monthsAfter: number) => {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + monthsAfter, 1, anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds()));
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(anchor.getUTCDate(), lastDay));
    return d.getTime();
  };
  const now = new Date(nowMs);
  let k = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth());
  if (at(k) > nowMs) k--;
  if (at(k + 1) <= nowMs) k++;
  return { start: at(k), end: at(k + 1) };
}
