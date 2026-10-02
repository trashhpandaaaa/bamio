import "server-only";
import Stripe from "stripe";
import { z } from "zod";
import {
  ALL_LOOKUP_KEYS,
  ENTITLED_STATUSES,
  fromLookupKey,
  intervalSchema,
  lookupKey,
  PLANS,
  planIdSchema,
  usageWindow,
  type BillingState,
  type Interval,
  type Plan,
  type PlanId,
} from "@/lib/billing/plans";
import { HttpError } from "@/lib/server/http";
import { addUsage, countProjects, hasUsage as usageCounted, isUserId, MAX_PROJECTS_PER_USER, readBilling, updateBilling, usageBetween } from "@/lib/server/store";

/*
 * Plans and payments: Stripe Checkout to buy a plan, the Stripe customer portal to change
 * it (plan, card, invoices, cancelling), and webhooks to keep the billing record (billing_accounts in Postgres) current. This is
 * the only module that reads STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET.
 *
 * Without STRIPE_SECRET_KEY billing is off: there are no plans to buy and nothing is limited.
 * With it, AI processing needs a working plan, and each plan has its minutes a month (minutes
 * of video imported, or of a followed stream transcribed), projects to keep, and a place in
 * the processing queues. Prices live in Stripe under the lookup keys of plans.ts (made by
 * `npm run stripe:setup`).
 */

/** On with a Stripe key, unless BAMIO_BILLING=off (the e2e test server, or local work without plans). */
export const billingEnabled = () => process.env.BAMIO_BILLING !== "off" && Boolean(process.env.STRIPE_SECRET_KEY);

let client: { key: string; stripe: Stripe } | null = null;

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !billingEnabled()) throw new HttpError(503, "billing_off", "Payments aren’t set up on this server.");
  if (client?.key !== key) client = { key, stripe: new Stripe(key, { maxNetworkRetries: 2, timeout: 20_000, appInfo: { name: "Bamio" } }) };
  return client.stripe;
}

/** A failed Stripe request as a message for people (the details go to the log). */
function stripeError(err: unknown): never {
  if (err instanceof HttpError) throw err;
  if (err instanceof Stripe.errors.StripeError) console.error(`[bamio/billing] Stripe request failed: ${err.type}: ${err.message}${err.requestId ? ` (${err.requestId})` : ""}`);
  else console.error("[bamio/billing] Stripe request failed", err);
  if (err instanceof Stripe.errors.StripeAuthenticationError) throw new HttpError(503, "billing_key", "Stripe refused this server’s key. Check STRIPE_SECRET_KEY in web/.env.");
  if (err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing") throw new HttpError(404, "not_found", "Stripe doesn’t know that payment.");
  throw new HttpError(502, "stripe", "Couldn’t reach Stripe. Try again in a moment.");
}

const isMissing = (err: unknown, param: string) => err instanceof Stripe.errors.StripeInvalidRequestError && err.code === "resource_missing" && err.param === param;

/* ------------------------------ Records ------------------------------ */

const subscriptionSchema = z.object({
  id: z.string(),
  status: z.string(),
  plan: planIdSchema,
  interval: intervalSchema,
  /** The subscription's billing anchor (ms): minutes renew on this day every month. */
  anchor: z.number(),
  /** The end of the period paid for (ms). */
  periodEnd: z.number(),
  /** When it stops, once cancelled (ms). */
  cancelAt: z.number().nullable(),
  /** When this was last read from Stripe (ms). */
  checkedAt: z.number(),
});
export type SubscriptionRecord = z.infer<typeof subscriptionSchema>;

const billingSchema = z.object({ customerId: z.string().optional(), subscription: subscriptionSchema.optional() });
type BillingRecord = z.infer<typeof billingSchema>;


/** Which plan a Stripe price is: by its lookup key, or by the metadata `npm run stripe:setup` puts on every price (kept when a price is replaced). */
export function planOfPrice(price: Pick<Stripe.Price, "lookup_key" | "metadata"> | null | undefined) {
  if (!price) return null;
  return fromLookupKey(price.lookup_key) ?? fromLookupKey(`bamio_${price.metadata?.bamio_plan}_${price.metadata?.bamio_interval}`);
}

/** The parts of a Stripe subscription Bamio keeps, or null if it isn't for one of Bamio's plans. */
export function subscriptionRecord(sub: Stripe.Subscription, now = Date.now()): SubscriptionRecord | null {
  const item = sub.items.data.find((i) => planOfPrice(i.price));
  const which = planOfPrice(item?.price);
  if (!item || !which) return null;
  const cancelAt = sub.cancel_at ?? (sub.cancel_at_period_end ? item.current_period_end : null);
  return {
    id: sub.id,
    status: sub.status,
    plan: which.plan,
    interval: which.interval,
    anchor: sub.billing_cycle_anchor * 1000,
    periodEnd: item.current_period_end * 1000,
    cancelAt: cancelAt === null ? null : cancelAt * 1000,
    checkedAt: now,
  };
}

/** A plan that works now: paid (or Stripe still retrying the payment), and not past a cancellation. */
export const isWorking = (sub: SubscriptionRecord | undefined, now = Date.now()): sub is SubscriptionRecord =>
  Boolean(sub && ENTITLED_STATUSES.has(sub.status) && (sub.cancelAt === null || sub.cancelAt > now));

/** Keep a subscription from Stripe. A working plan isn't replaced by another subscription that doesn't work (a second checkout left unpaid). */
async function saveSubscription(userId: string, sub: Stripe.Subscription): Promise<BillingRecord> {
  const record = subscriptionRecord(sub);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  return updateBilling(userId, billingSchema, (current) => {
    const billing = current ?? {};
    if (!record || (billing.customerId && billing.customerId !== customerId)) return billing;
    const kept = billing.subscription;
    if (kept && kept.id !== record.id && isWorking(kept) && !isWorking(record)) return billing;
    return { ...billing, customerId, subscription: record };
  });
}

const FINAL_STATUSES = new Set(["canceled", "incomplete_expired"]);
const refreshing = new Map<string, Promise<BillingRecord>>();
const refreshFailed = new Map<string, number>();

/** The customer's subscriptions in Stripe, keeping the one that matters: a working one, else the newest. */
async function readFromStripe(userId: string, customerId: string): Promise<BillingRecord> {
  let list: Stripe.ApiList<Stripe.Subscription>;
  try {
    list = await stripe().subscriptions.list({ customer: customerId, status: "all", limit: 20 });
  } catch (err) {
    // The customer was deleted in Stripe (test data cleared): start over.
    if (!isMissing(err, "customer")) throw err;
    return updateBilling(userId, billingSchema, () => ({}));
  }
  const ours = list.data.filter((s) => subscriptionRecord(s)).sort((a, b) => b.created - a.created);
  const best = ours.find((s) => isWorking(subscriptionRecord(s)!)) ?? ours[0];
  if (best) return saveSubscription(userId, best);
  // None left in Stripe: a subscription kept here no longer counts.
  return updateBilling(userId, billingSchema, (current) =>
    current?.subscription ? { ...current, subscription: { ...current.subscription, status: "canceled", checkedAt: Date.now() } } : (current ?? {}),
  );
}

/**
 * The user's billing record. Read from Stripe again when it may have changed without a
 * webhook saying so (a renewal or payment due, or half an hour old), or with `fresh` (back
 * from Checkout or the billing portal), so plans also work where Stripe's webhooks can't
 * reach the server.
 */
async function billingRecord(userId: string, opts: { fresh?: boolean } = {}): Promise<BillingRecord> {
  const billing = (await readBilling(userId, billingSchema)) ?? {};
  const { customerId, subscription: sub } = billing;
  const now = Date.now();
  if (!billingEnabled() || !customerId) return billing;
  if (!opts.fresh) {
    if (!sub || FINAL_STATUSES.has(sub.status)) return billing;
    const maxAge = now >= sub.periodEnd || !isWorking(sub, now) ? 60_000 : 30 * 60_000;
    if (now - sub.checkedAt < maxAge || now - (refreshFailed.get(userId) ?? 0) < 60_000) return billing;
  }
  let pending = refreshing.get(userId);
  if (!pending) {
    pending = readFromStripe(userId, customerId)
      .catch((err: unknown) => {
        console.warn("[bamio/billing] couldn’t read the plan from Stripe:", err instanceof Error ? err.message : err);
        refreshFailed.set(userId, Date.now());
        return billing;
      })
      .finally(() => refreshing.delete(userId));
    refreshing.set(userId, pending);
  }
  return pending;
}

/* ------------------------------ Allowance ------------------------------ */

type Allowance = { plan: Plan; usedSec: number; allowanceSec: number; resetsAt: number };

/** The user's working plan and this month's use of it, or null without one. */
async function allowance(userId: string, billing?: BillingRecord): Promise<Allowance | null> {
  const sub = (billing ?? (await billingRecord(userId))).subscription;
  if (!isWorking(sub)) return null;
  const window = usageWindow(sub.anchor, Date.now());
  const usedSec = await usageBetween(userId, window.start, window.end);
  const plan = PLANS[sub.plan];
  return { plan, usedSec, allowanceSec: plan.minutes * 60, resetsAt: window.end };
}

/** What the pages show: plan, renewal, minutes used, projects. `fresh`: read the plan from Stripe first. */
export async function billingState(userId: string, opts: { fresh?: boolean } = {}): Promise<BillingState> {
  const count = await countProjects(userId);
  if (!billingEnabled()) {
    return { enabled: false, active: false, plan: null, interval: null, status: null, periodEnd: null, ending: false, usage: null, projects: { count, limit: MAX_PROJECTS_PER_USER }, canManage: false };
  }
  const billing = await billingRecord(userId, opts);
  const sub = billing.subscription;
  const current = await allowance(userId, billing);
  return {
    enabled: true,
    active: current !== null,
    plan: sub?.plan ?? null,
    interval: sub?.interval ?? null,
    status: sub?.status ?? null,
    periodEnd: sub ? (sub.cancelAt ?? sub.periodEnd) : null,
    ending: Boolean(sub && sub.cancelAt !== null),
    usage: current ? { usedSec: current.usedSec, allowanceSec: current.allowanceSec, resetsAt: current.resetsAt } : null,
    projects: { count, limit: current?.plan.projects ?? 0 },
    canManage: Boolean(billing.customerId),
  };
}

/** A few seconds over the minutes left don't block a video. */
const GRACE_SEC = 60;

const formatDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
const minutesText = (minutes: number) => `${minutes.toLocaleString("en-US")} ${minutes === 1 ? "minute" : "minutes"}`;

/** What to suggest when a video is longer than the minutes left. */
const SHORTER = { link: "Import a part of it", upload: "Upload a shorter video", capture: "Capture a shorter part" } as const;

/**
 * Before new AI processing (an import, a capture, following a stream): a working plan with
 * minutes left, and enough of them for `need` when the length is known. Nothing with billing off.
 */
export async function assertCanProcess(userId: string, need?: { sec: number; source: keyof typeof SHORTER }): Promise<void> {
  if (!billingEnabled()) return;
  const current = await allowance(userId);
  if (!current) throw new HttpError(402, "plan_required", "Choose a plan to import videos.");
  const left = current.allowanceSec - current.usedSec;
  if (left < 30) {
    throw new HttpError(402, "minutes_used", `You’ve used this month’s ${current.plan.minutes.toLocaleString("en-US")} AI minutes. More arrive on ${formatDay(current.resetsAt)}, or upgrade for more now.`);
  }
  if (need && need.sec > left + GRACE_SEC) {
    throw new HttpError(
      402,
      "minutes_short",
      `This video is ${minutesText(Math.ceil(need.sec / 60))} long, and you have ${minutesText(Math.floor(left / 60))} left this month. ${SHORTER[need.source]}, or upgrade for more.`,
    );
  }
}

/** Before AI work on a video already imported (finding more clips, transcribing again): a working plan. */
export async function assertPlan(userId: string): Promise<void> {
  if (!billingEnabled()) return;
  if (!(await allowance(userId))) throw new HttpError(402, "plan_required", "Choose a plan to use AI on your videos.");
}

/** AI processing left this month, in seconds: Infinity with billing off, 0 without a plan. */
export async function secondsLeft(userId: string): Promise<number> {
  if (!billingEnabled()) return Infinity;
  const current = await allowance(userId);
  return current ? Math.max(0, current.allowanceSec - current.usedSec) : 0;
}

/** Count AI processing against this month's minutes, once per `key` (a project's import, or a piece of a followed stream). */
export async function recordUsage(userId: string, key: string, sec: number): Promise<void> {
  if (!billingEnabled() || !(sec > 0)) return;
  await addUsage(userId, key, Math.round(sec * 10) / 10);
}

/** True once `key` has been counted (an import being retried). */
export async function hasUsage(userId: string, key: string): Promise<boolean> {
  if (!billingEnabled()) return false;
  return usageCounted(userId, key);
}

/** Place in the processing queues: plans with priority processing go first. */
export async function queuePriority(userId: string): Promise<number> {
  if (!billingEnabled()) return 0;
  return (await allowance(userId).catch(() => null))?.plan.priority ?? 0;
}

/** How many projects the user may keep. */
export async function projectLimit(userId: string): Promise<number> {
  if (!billingEnabled()) return MAX_PROJECTS_PER_USER;
  return (await allowance(userId))?.plan.projects ?? 0;
}

/* ------------------------------ Stripe pages ------------------------------ */

/** Where Stripe sends people back to: BAMIO_APP_URL, or the address this request came to. */
export function appOrigin(req: Request): string {
  return process.env.BAMIO_APP_URL?.replace(/\/+$/, "") || new URL(req.url).origin;
}

let prices: { at: number; ids: Map<string, string> } | null = null;

/** The Stripe price for a plan and billing period, found by lookup key (cached for 10 minutes). */
async function priceId(plan: PlanId, interval: Interval): Promise<string> {
  const key = lookupKey(plan, interval);
  if (!prices || Date.now() - prices.at > 10 * 60_000 || !prices.ids.has(key)) {
    const list = await stripe().prices.list({ lookup_keys: ALL_LOOKUP_KEYS, active: true, limit: 100 });
    const ids = new Map<string, string>();
    for (const price of list.data) {
      const which = fromLookupKey(price.lookup_key);
      if (!which) continue;
      ids.set(price.lookup_key!, price.id);
      const expected = PLANS[which.plan].price[which.interval];
      if (price.unit_amount !== expected) console.warn(`[bamio/billing] Stripe price ${price.lookup_key} is ${price.unit_amount} cents, plans.ts says ${expected}. Run npm run stripe:setup.`);
    }
    prices = { at: Date.now(), ids };
  }
  const id = prices.ids.get(key);
  if (!id) throw new HttpError(503, "billing_setup", `The ${PLANS[plan].name} plan isn’t set up in Stripe yet. In web/, run npm run stripe:setup.`);
  return id;
}

/** The user's Stripe customer, made on their first checkout (under the billing file's lock, so only one is made). */
async function customerFor(userId: string, email: string | undefined): Promise<string> {
  const billing = await updateBilling(userId, billingSchema, async (current) => {
    if (current?.customerId) return current;
    const customer = await stripe().customers.create({ email, metadata: { bamio_user: userId } });
    return { ...current, customerId: customer.id };
  });
  if (!billing.customerId) throw new HttpError(502, "stripe", "Couldn’t set up your billing. Try again.");
  return billing.customerId;
}

/** A Stripe Checkout page for a plan, billed every month or every 3 months. */
export async function createCheckout(userId: string, input: { plan: PlanId; interval: Interval; origin: string; email?: string }): Promise<string> {
  const billing = await billingRecord(userId);
  if (isWorking(billing.subscription)) throw new HttpError(409, "has_plan", "You already have a plan. Change it from Billing.");
  try {
    const price = await priceId(input.plan, input.interval);
    const open = async () =>
      stripe().checkout.sessions.create({
        mode: "subscription",
        customer: await customerFor(userId, input.email),
        client_reference_id: userId,
        line_items: [{ price, quantity: 1 }],
        subscription_data: { metadata: { bamio_user: userId } },
        metadata: { bamio_user: userId },
        allow_promotion_codes: true,
        // The billing page reads the new plan from Stripe as it opens.
        success_url: `${input.origin}/billing?checkout=done`,
        cancel_url: `${input.origin}/pricing?checkout=canceled`,
      });
    let session: Stripe.Checkout.Session;
    try {
      session = await open();
    } catch (err) {
      // The saved customer was deleted in Stripe (test data cleared): start over with a new one.
      if (!isMissing(err, "customer")) throw err;
      await updateBilling(userId, billingSchema, () => ({}));
      session = await open();
    }
    if (!session.url) throw new HttpError(502, "stripe", "Stripe didn’t return a checkout page. Try again.");
    return session.url;
  } catch (err) {
    stripeError(err);
  }
}

let portal: { at: number; id: string | null } | null = null;

/** The portal settings `npm run stripe:setup` made (plan switching between Bamio's prices), else Stripe's default. */
async function portalConfiguration(): Promise<string | null> {
  if (portal && Date.now() - portal.at < 10 * 60_000) return portal.id;
  const list = await stripe().billingPortal.configurations.list({ active: true, limit: 100 });
  portal = { at: Date.now(), id: list.data.find((c) => c.metadata?.bamio === "portal")?.id ?? null };
  return portal.id;
}

/**
 * A Stripe customer portal page: change plan, card, invoices, cancel. With `target`, it opens
 * on confirming the switch to that plan (where the portal settings allow it, else its home page).
 */
export async function createPortal(userId: string, origin: string, target?: { plan: PlanId; interval: Interval }): Promise<string> {
  const billing = await billingRecord(userId);
  if (!billing.customerId) throw new HttpError(409, "no_customer", "You don’t have a plan yet. Choose one on Pricing.");
  try {
    const configuration = await portalConfiguration();
    const base = { customer: billing.customerId, return_url: `${origin}/billing`, ...(configuration ? { configuration } : {}) };
    const sub = billing.subscription;
    if (target && isWorking(sub)) {
      try {
        const live = await stripe().subscriptions.retrieve(sub.id);
        const item = live.items.data.find((i) => planOfPrice(i.price));
        if (item) {
          const session = await stripe().billingPortal.sessions.create({
            ...base,
            flow_data: {
              type: "subscription_update_confirm",
              subscription_update_confirm: { subscription: sub.id, items: [{ id: item.id, price: await priceId(target.plan, target.interval), quantity: 1 }] },
              after_completion: { type: "redirect", redirect: { return_url: `${origin}/billing?changed=1` } },
            },
          });
          return session.url;
        }
      } catch (err) {
        console.warn("[bamio/billing] no plan-switch page, opening the portal:", err instanceof Error ? err.message : err);
      }
    }
    return (await stripe().billingPortal.sessions.create(base)).url;
  } catch (err) {
    if (err instanceof Stripe.errors.StripeInvalidRequestError && /configuration/i.test(err.message)) {
      throw new HttpError(503, "billing_setup", "The billing portal isn’t set up in Stripe yet. In web/, run npm run stripe:setup.");
    }
    stripeError(err);
  }
}

/* ------------------------------ Webhooks ------------------------------ */

/** A webhook event, once Stripe's signature over the raw body checks out. */
export function verifyWebhook(payload: string, signature: string | null): Stripe.Event {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !billingEnabled()) throw new HttpError(503, "billing_off", "Stripe webhooks aren’t set up on this server.");
  if (!signature) throw new HttpError(400, "bad_signature", "Missing the Stripe-Signature header.");
  try {
    return Stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    throw new HttpError(400, "bad_signature", "The webhook signature doesn’t match.");
  }
}

/** Keep the billing record in step with Stripe. Subscriptions are read fresh from Stripe, so events arriving out of order don't matter. */
export async function handleWebhook(event: Stripe.Event): Promise<void> {
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const id = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
        if (session.mode === "subscription" && id) await syncSubscription(id, session.client_reference_id);
        return;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
      case "customer.subscription.pending_update_applied":
      case "customer.subscription.pending_update_expired":
        await syncSubscription(event.data.object.id);
        return;
      default:
        return;
    }
  } catch (err) {
    stripeError(err);
  }
}

async function syncSubscription(id: string, userHint?: string | null) {
  const sub = await stripe().subscriptions.retrieve(id);
  const userId = sub.metadata?.bamio_user || userHint || (await customerUser(sub.customer));
  if (!userId || !isUserId(userId)) {
    console.warn(`[bamio/billing] subscription ${id} isn’t linked to a Bamio user; ignored`);
    return;
  }
  await saveSubscription(userId, sub);
}

/** The Bamio user a Stripe customer belongs to (customers Bamio makes carry it in their metadata). */
async function customerUser(customer: Stripe.Subscription["customer"]): Promise<string | null> {
  const found = typeof customer === "string" ? await stripe().customers.retrieve(customer) : customer;
  if ("deleted" in found && found.deleted) return null;
  return found.metadata?.bamio_user ?? null;
}
