import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Stripe from "stripe";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ALL_LOOKUP_KEYS, formatPrice, fromLookupKey, lookupKey, minutesLeft, PLAN_IDS, PLANS, quarterSaving, usageWindow, usedMinutes } from "@/lib/billing/plans";
import {
  assertCanProcess,
  assertPlan,
  billingState,
  closeBilling,
  hasUsage,
  isWorking,
  minutesNotice,
  planOfPrice,
  projectLimit,
  WEBHOOK_EVENTS,
  queuePriority,
  recordUsage,
  saveSubscription,
  secondsLeft,
  subscriptionNotices,
  subscriptionRecord,
  verifyWebhook,
  type SubscriptionRecord,
} from "@/lib/server/billing";
import { db } from "@/lib/server/db";
import { limiter } from "@/lib/server/limiter";

const utc = (s: string) => Date.parse(`${s}Z`);

describe("webhook", () => {
  it("has Stripe send exactly the events Bamio acts on", () => {
    const script = readFileSync("scripts/setup-stripe.mjs", "utf8");
    const start = script.indexOf("const EVENTS = [");
    const listed = [...script.slice(start, script.indexOf("];", start)).matchAll(/"([a-z_.]+)"/g)].map((m) => m[1]);
    expect(listed).toEqual([...WEBHOOK_EVENTS]);
  });
});

describe("plans", () => {
  it("has the prices and minutes of the pricing sheet", () => {
    expect(PLAN_IDS.map((id) => [PLANS[id].price.month, PLANS[id].price.quarter, PLANS[id].minutes])).toEqual([
      [1200, 3000, 150],
      [2400, 6000, 400],
      [5400, 14400, 1000],
    ]);
    expect(PLANS.pro.popular).toBe(true);
    // "Save $6 compared to $36 monthly", and so on.
    expect(PLAN_IDS.map((id) => `${formatPrice(quarterSaving(PLANS[id]))} vs ${formatPrice(PLANS[id].price.month * 3)}`)).toEqual(["$6 vs $36", "$12 vs $72", "$18 vs $162"]);
    for (const id of PLAN_IDS) expect(PLANS[id].features[0]!.text).toBe(`${PLANS[id].minutes.toLocaleString("en-US")} AI processing minutes/month`);
  });

  it("names Stripe prices by lookup key, and reads them back", () => {
    expect(ALL_LOOKUP_KEYS).toHaveLength(6);
    for (const plan of PLAN_IDS) for (const interval of ["month", "quarter"] as const) expect(fromLookupKey(lookupKey(plan, interval))).toEqual({ plan, interval });
    expect(fromLookupKey("bamio_gold_month")).toBeNull();
    expect(fromLookupKey(null)).toBeNull();
    // A replaced price lost its lookup key but keeps the metadata.
    expect(planOfPrice({ lookup_key: null, metadata: { bamio_plan: "team", bamio_interval: "quarter" } })).toEqual({ plan: "team", interval: "quarter" });
    expect(planOfPrice({ lookup_key: "other_product", metadata: {} })).toBeNull();
  });

  it("formats prices and minutes for people", () => {
    expect(formatPrice(14400)).toBe("$144");
    expect(formatPrice(1250)).toBe("$12.50");
    expect(usedMinutes(61)).toBe(2);
    expect(usedMinutes(60)).toBe(1);
    expect(Object.is(usedMinutes(0), 0)).toBe(true); // not -0 ("-0 used")
    expect(minutesLeft({ usedSec: 61, allowanceSec: 9000, resetsAt: 0 })).toBe(148);
    expect(minutesLeft({ usedSec: 9500, allowanceSec: 9000, resetsAt: 0 })).toBe(0);
  });
});

describe("usage months", () => {
  it("renews on the day the plan started", () => {
    const anchor = utc("2027-01-15T10:00:00");
    expect(usageWindow(anchor, utc("2027-03-20T08:00:00"))).toEqual({ start: utc("2027-03-15T10:00:00"), end: utc("2027-04-15T10:00:00") });
    expect(usageWindow(anchor, utc("2027-03-15T09:59:59"))).toEqual({ start: utc("2027-02-15T10:00:00"), end: utc("2027-03-15T10:00:00") });
    // The renewal moment itself starts the new month.
    expect(usageWindow(anchor, utc("2027-03-15T10:00:00")).start).toBe(utc("2027-03-15T10:00:00"));
    expect(usageWindow(anchor, anchor)).toEqual({ start: anchor, end: utc("2027-02-15T10:00:00") });
  });

  it("clamps to the end of short months", () => {
    const anchor = utc("2027-01-31T12:00:00");
    expect(usageWindow(anchor, utc("2027-02-28T11:00:00"))).toEqual({ start: anchor, end: utc("2027-02-28T12:00:00") });
    expect(usageWindow(anchor, utc("2027-02-28T13:00:00"))).toEqual({ start: utc("2027-02-28T12:00:00"), end: utc("2027-03-31T12:00:00") });
    expect(usageWindow(anchor, utc("2027-04-30T13:00:00")).start).toBe(utc("2027-04-30T12:00:00"));
    expect(usageWindow(utc("2027-12-31T00:00:00"), utc("2028-02-29T01:00:00")).start).toBe(utc("2028-02-29T00:00:00"));
  });

  it("always contains now", () => {
    const anchor = utc("2026-05-31T23:30:00");
    for (let t = utc("2026-06-01T00:00:00"); t < utc("2028-06-01T00:00:00"); t += 37 * 3600_000 + 1234) {
      const w = usageWindow(anchor, t);
      expect(w.start).toBeLessThanOrEqual(t);
      expect(w.end).toBeGreaterThan(t);
      expect(w.end - w.start).toBeGreaterThanOrEqual(27 * 86400_000);
      expect(w.end - w.start).toBeLessThanOrEqual(31 * 86400_000);
    }
  });
});

describe("queues", () => {
  it("start waiting work by priority, then in order, never more than the limit at once", async () => {
    const run = limiter(1);
    const order: string[] = [];
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const task = (name: string, wait?: Promise<void>) => async () => {
      active++;
      peak = Math.max(peak, active);
      order.push(name);
      await (wait ?? Promise.resolve());
      active--;
    };
    const all = [run(task("first", gate)), run(task("a0"), 0), run(task("b1"), 1), run(task("c0"), 0), run(task("d1"), 1)];
    release();
    await Promise.all(all);
    expect(order).toEqual(["first", "b1", "d1", "a0", "c0"]);
    expect(peak).toBe(1);
  });

  it("keep running after a task fails", async () => {
    const run = limiter(2);
    const results = await Promise.allSettled([run(async () => Promise.reject(new Error("x"))), run(async () => 1), run(async () => 2), run(async () => 3)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "fulfilled", "fulfilled", "fulfilled"]);
  });
});

describe("subscriptions from Stripe", () => {
  const sub = (over: Partial<Record<string, unknown>> = {}, price: Record<string, unknown> = { lookup_key: "bamio_pro_quarter", metadata: {} }) =>
    ({
      id: "sub_1",
      status: "active",
      customer: "cus_1",
      billing_cycle_anchor: 1_800_000_000,
      cancel_at: null,
      cancel_at_period_end: false,
      created: 1_800_000_000,
      metadata: { bamio_user: "user_a" },
      items: { data: [{ id: "si_1", price, current_period_start: 1_800_000_000, current_period_end: 1_807_776_000 }] },
      ...over,
    }) as unknown as Stripe.Subscription;

  it("keeps the plan, period and cancellation", () => {
    expect(subscriptionRecord(sub(), 5)).toEqual({
      id: "sub_1",
      status: "active",
      plan: "pro",
      interval: "quarter",
      anchor: 1_800_000_000_000,
      periodEnd: 1_807_776_000_000,
      cancelAt: null,
      checkedAt: 5,
    });
    expect(subscriptionRecord(sub({ cancel_at_period_end: true }))!.cancelAt).toBe(1_807_776_000_000);
    expect(subscriptionRecord(sub({}, { lookup_key: "someone_else", metadata: {} }))).toBeNull();
  });

  it("works while paid or retrying, not once ended", () => {
    const base = subscriptionRecord(sub())!;
    const at = (s: Partial<SubscriptionRecord>) => isWorking({ ...base, ...s }, 1_805_000_000_000);
    expect(at({})).toBe(true);
    expect(at({ status: "past_due" })).toBe(true);
    expect(at({ status: "trialing" })).toBe(true);
    expect(at({ status: "canceled" })).toBe(false);
    expect(at({ status: "unpaid" })).toBe(false);
    expect(at({ status: "incomplete" })).toBe(false);
    expect(at({ cancelAt: 1_806_000_000_000 })).toBe(true);
    expect(at({ cancelAt: 1_804_000_000_000 })).toBe(false);
    expect(isWorking(undefined)).toBe(false);
  });
});

describe("plan emails", () => {
  const base: SubscriptionRecord = { id: "sub_1", status: "active", plan: "pro", interval: "month", anchor: 0, periodEnd: 1_807_776_000_000, cancelAt: null, checkedAt: 0 };
  const sent = (before: SubscriptionRecord | undefined, after: SubscriptionRecord | undefined) => subscriptionNotices(before, after).map((n) => n.email.template);

  it("follow what changed in the subscription", () => {
    expect(sent(undefined, base)).toEqual(["plan-started"]);
    expect(sent({ ...base, status: "incomplete" }, base)).toEqual(["plan-started"]); // paid at last
    expect(sent(undefined, { ...base, status: "incomplete" })).toEqual([]);
    expect(sent(base, { ...base, checkedAt: 5 })).toEqual([]); // read again, nothing new
    expect(sent(base, { ...base, plan: "team" })).toEqual(["plan-changed"]);
    expect(sent(base, { ...base, interval: "quarter" })).toEqual(["plan-changed"]);
    expect(sent(base, { ...base, status: "past_due" })).toEqual(["payment-failed"]);
    expect(sent({ ...base, status: "past_due" }, base)).toEqual([]); // paid on a retry
    expect(sent(base, { ...base, cancelAt: 1 })).toEqual(["plan-ending"]);
    expect(sent({ ...base, cancelAt: 1 }, base)).toEqual(["plan-resumed"]);
    expect(sent({ ...base, cancelAt: 1 }, { ...base, cancelAt: 1, status: "canceled" })).toEqual(["plan-ended"]);
    expect(sent({ ...base, status: "past_due" }, { ...base, status: "unpaid" })).toEqual(["plan-ended"]);
    expect(sent({ ...base, status: "canceled" }, { ...base, status: "canceled" })).toEqual([]);
    expect(sent(base, { ...base, id: "sub_2" })).toEqual(["plan-started"]);
    expect(sent(base, { ...base, plan: "team", cancelAt: 1 })).toEqual(["plan-changed", "plan-ending"]);
    expect(subscriptionNotices(base, { ...base, plan: "team" })[0]).toMatchObject({ email: { from: "pro", plan: "team", interval: "month" } });
  });

  it("go out once per change, queued with the plan they report", async () => {
    const user = "user_mailplan";
    const stripeSub = (over: Record<string, unknown> = {}) =>
      ({
        id: "sub_mail",
        status: "active",
        customer: "cus_mail",
        billing_cycle_anchor: 1_800_000_000,
        cancel_at: null,
        cancel_at_period_end: false,
        created: 1_800_000_000,
        metadata: {},
        items: { data: [{ id: "si_1", price: { lookup_key: "bamio_starter_month", metadata: {} }, current_period_start: 1_800_000_000, current_period_end: 1_802_592_000 }] },
        ...over,
      }) as unknown as Stripe.Subscription;
    process.env.BAMIO_EMAIL = "preview";
    try {
      await db()`delete from emails where user_id = ${user}`;
      await saveSubscription(user, stripeSub({ status: "incomplete" }));
      await saveSubscription(user, stripeSub());
      await saveSubscription(user, stripeSub()); // the same webhook again
      await saveSubscription(user, stripeSub({ cancel_at_period_end: true }));
      await saveSubscription(user, stripeSub({ status: "canceled", cancel_at_period_end: true }));
      const rows = await db()<{ template: string; data: unknown }[]>`select template, data from emails where user_id = ${user} order by id`;
      expect(rows.map((r) => r.template)).toEqual(["plan-started", "plan-ending", "plan-ended"]);
      expect(rows[0]!.data).toEqual({ template: "plan-started", plan: "starter", interval: "month", renewsAt: 1_802_592_000_000 });
    } finally {
      delete process.env.BAMIO_EMAIL;
    }
  });

  it("warn when most of the minutes are used, then when they're used up", () => {
    const month = { allowanceSec: 400 * 60, resetsAt: 5 };
    expect(minutesNotice(base, { ...month, usedSec: 319 * 60 })).toBeNull();
    expect(minutesNotice(base, { ...month, usedSec: 320 * 60 })).toEqual({
      key: "minutes-low:sub_1:pro:5",
      email: { template: "minutes-low", plan: "pro", usedMin: 320, allowanceMin: 400, resetsAt: 5 },
    });
    expect(minutesNotice(base, { ...month, usedSec: 400 * 60 - 29 })?.key).toBe("minutes-out:sub_1:pro:5");
    // After an upgrade the new plan's minutes count, and its warnings are new ones.
    expect(minutesNotice({ ...base, plan: "team" }, { allowanceSec: 1000 * 60, resetsAt: 5, usedSec: 900 * 60 })?.key).toBe("minutes-low:sub_1:team:5");
  });
});

describe("webhooks", () => {
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });

  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it("accept only Stripe's signature", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_unit";
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_unit" });
    expect(verifyWebhook(payload, header).type).toBe("customer.subscription.updated");
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_other" });
    expect(() => verifyWebhook(payload, forged)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => verifyWebhook(payload.replace("sub_1", "sub_2"), header)).toThrow(expect.objectContaining({ status: 400 }));
    expect(() => verifyWebhook(payload, null)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it("are refused when not set up", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    expect(() => verifyWebhook(payload, "t=1,v1=x")).toThrow(expect.objectContaining({ status: 503 }));
  });
});

describe("plan limits", () => {
  let dir: string;
  const user = "user_billing1";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bamio-billing-"));
    process.env.BAMIO_DATA_DIR = dir;
  });
  afterAll(async () => {
    delete process.env.BAMIO_DATA_DIR;
    delete process.env.STRIPE_SECRET_KEY;
    await rm(dir, { recursive: true, force: true });
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  /** A plan as webhooks or a checkout would have saved it (read just now, so nothing asks Stripe). */
  async function givePlan(userId: string, plan: "starter" | "pro" | "team", over: Partial<SubscriptionRecord> = {}) {
    const now = Date.now();
    const subscription: SubscriptionRecord = { id: `sub_${userId}`, status: "active", plan, interval: "month", anchor: now - 86400_000, periodEnd: now + 29 * 86400_000, cancelAt: null, checkedAt: now, ...over };
    const data = { customerId: `cus_${userId}`, subscription };
    await db()`insert into billing_accounts (user_id, data, updated_at) values (${userId}, ${db().json(data)}, ${now})
      on conflict (user_id) do update set data = excluded.data`;
  }

  it("limit nothing with billing off", async () => {
    await expect(assertCanProcess(user, { sec: 10 * 3600, source: "link" })).resolves.toBeUndefined();
    await expect(assertPlan(user)).resolves.toBeUndefined();
    expect(await secondsLeft(user)).toBe(Infinity);
    expect(await projectLimit(user)).toBe(100);
    expect(await queuePriority(user)).toBe(0);
    await recordUsage(user, "p1", 600);
    expect(await hasUsage(user, "p1")).toBe(false);
    expect(await billingState(user)).toMatchObject({ enabled: false, active: false, projects: { count: 0, limit: 100 } });
    // A key with BAMIO_BILLING=off (the e2e test server) is off too: nothing is limited, and deleting an account never calls Stripe.
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    process.env.BAMIO_BILLING = "off";
    try {
      await expect(assertCanProcess("user_noplan")).resolves.toBeUndefined();
      await expect(closeBilling("user_noplan")).resolves.toBeUndefined();
      expect((await billingState("user_noplan")).enabled).toBe(false);
    } finally {
      delete process.env.BAMIO_BILLING;
    }
  });

  it("give a new account its first video free, then need a plan", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    const fresh = "user_trial";
    await db()`delete from usage_entries where user_id = ${fresh}`;
    // Up to 8 minutes of video, with AI on it, one project at a time.
    await expect(assertCanProcess(fresh, { sec: 7 * 60, source: "link" })).resolves.toBeUndefined();
    await expect(assertCanProcess(fresh, { sec: 25 * 60, source: "link" })).rejects.toMatchObject({ status: 402, code: "minutes_short", message: expect.stringContaining("Import a part of it") });
    await expect(assertCanProcess(fresh, { sec: 45 * 60, source: "upload" })).rejects.toMatchObject({
      status: 402,
      code: "minutes_short",
      message: expect.stringContaining("your free trial has 8 minutes left. Upload a shorter video"),
    });
    await expect(assertPlan(fresh)).resolves.toBeUndefined();
    expect(await secondsLeft(fresh)).toBe(8 * 60);
    expect(await projectLimit(fresh)).toBe(1);
    expect(await queuePriority(fresh)).toBe(0);
    expect(await billingState(fresh)).toMatchObject({ enabled: true, active: false, plan: null, usage: null, trial: { usedSec: 0, allowanceSec: 480 }, projects: { limit: 1 } });
    // Its minutes count over the account's whole life, and once used they're gone.
    await recordUsage(fresh, "p1", 6 * 60);
    expect(await secondsLeft(fresh)).toBe(2 * 60);
    await recordUsage(fresh, "p2", 2 * 60);
    await expect(assertCanProcess(fresh)).rejects.toMatchObject({ status: 402, code: "trial_used" });
    expect((await billingState(fresh)).trial).toEqual({ usedSec: 480, allowanceSec: 480 });
    // An account that had a plan doesn't get a trial when it ends: its plan is shown, and doesn't work.
    await givePlan("user_ended", "pro", { status: "canceled" });
    await expect(assertCanProcess("user_ended")).rejects.toMatchObject({ code: "plan_required" });
    await expect(assertPlan("user_ended")).rejects.toMatchObject({ code: "plan_required" });
    expect(await secondsLeft("user_ended")).toBe(0);
    expect(await billingState("user_ended")).toMatchObject({ active: false, plan: "pro", status: "canceled", canManage: true, trial: null });
  });

  it("count AI minutes once per import, and stop at the plan's minutes", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    await givePlan(user, "starter");
    expect(await projectLimit(user)).toBe(50);
    expect(await queuePriority(user)).toBe(0);
    await expect(assertCanProcess(user, { sec: 30 * 60, source: "link" })).resolves.toBeUndefined();
    await expect(assertCanProcess(user, { sec: 200 * 60, source: "upload" })).rejects.toMatchObject({ status: 402, code: "minutes_short", message: expect.stringContaining("Upload a shorter video") });

    await recordUsage(user, "project-a", 140 * 60);
    await recordUsage(user, "project-a", 140 * 60); // a retried import counts once
    expect(await hasUsage(user, "project-a")).toBe(true);
    expect(await secondsLeft(user)).toBe(10 * 60);
    await expect(assertCanProcess(user, { sec: 10.5 * 60, source: "link" })).resolves.toBeUndefined(); // a few seconds over is fine
    await expect(assertCanProcess(user, { sec: 20 * 60, source: "link" })).rejects.toMatchObject({ code: "minutes_short", message: expect.stringContaining("10 minutes left") });

    // Pieces of a followed stream, recorded at once, all land.
    await Promise.all(Array.from({ length: 10 }, (_, i) => recordUsage(user, `project-b@${i * 60}`, 60)));
    expect(await secondsLeft(user)).toBe(0);
    await expect(assertCanProcess(user)).rejects.toMatchObject({ status: 402, code: "minutes_used" });
    expect(await billingState(user)).toMatchObject({ active: true, plan: "starter", usage: { usedSec: 150 * 60, allowanceSec: 150 * 60 }, projects: { limit: 50 } });
    // Finding more clips in what was imported still works.
    await expect(assertPlan(user)).resolves.toBeUndefined();
  });

  it("email once at 80% of the minutes and once when they're used up", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    process.env.BAMIO_EMAIL = "preview";
    const who = "user_mailmin";
    try {
      await db()`delete from emails where user_id = ${who}`;
      await givePlan(who, "starter");
      await recordUsage(who, "a", 100 * 60); // 67%
      await recordUsage(who, "b", 25 * 60); // 83%
      await recordUsage(who, "c", 5 * 60); // 87%: already told
      await recordUsage(who, "d", 20 * 60); // all 150
      const rows = await db()<{ template: string; data: { usedMin?: number } }[]>`select template, data from emails where user_id = ${who} order by id`;
      expect(rows.map((r) => r.template)).toEqual(["minutes-low", "minutes-out"]);
      expect(rows[0]!.data.usedMin).toBe(125);
    } finally {
      delete process.env.BAMIO_EMAIL;
    }
  });

  it("give a plan for free with a grant, and keep the better of a grant and a paid plan", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    const grant = (who: string, plan: string) => db()`insert into plan_grants (user_id, plan, note, created_at) values (${who}, ${plan}, 'test', ${Date.now() - 86400_000})
      on conflict (user_id) do update set plan = excluded.plan`;
    await grant("user_owner", "pro");
    await expect(assertCanProcess("user_owner", { sec: 60 * 60, source: "link" })).resolves.toBeUndefined();
    expect(await secondsLeft("user_owner")).toBe(400 * 60);
    expect(await projectLimit("user_owner")).toBe(150);
    expect(await queuePriority("user_owner")).toBe(1);
    expect(await billingState("user_owner")).toMatchObject({ active: true, granted: true, plan: "pro", interval: null, status: "granted", periodEnd: null, canManage: false });
    await recordUsage("user_owner", "g1", 30 * 60);
    expect(await secondsLeft("user_owner")).toBe(370 * 60);

    // Paying for more than the grant gives: the paid plan counts. Paying for less: the grant does.
    await givePlan("user_owner", "team");
    expect(await billingState("user_owner")).toMatchObject({ plan: "team", granted: false, status: "active" });
    await givePlan("user_owner", "starter");
    expect(await billingState("user_owner")).toMatchObject({ plan: "pro", granted: true });

    // Taken back: only what's paid for.
    await db()`delete from plan_grants where user_id = 'user_owner'`;
    expect(await billingState("user_owner")).toMatchObject({ plan: "starter", granted: false });
    await grant("user_owner", "none_such").catch(() => "refused");
    expect(await db()`select 1 from plan_grants where user_id = 'user_owner'`).toHaveLength(0);
  });

  it("give paid plans their minutes, room and place in the queue", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    await givePlan("user_team", "team");
    expect(await secondsLeft("user_team")).toBe(1000 * 60);
    expect(await projectLimit("user_team")).toBe(400);
    expect(await queuePriority("user_team")).toBe(1);
    // Last month's minutes don't count against this month.
    await givePlan("user_pro", "pro", { anchor: Date.now() - 40 * 86400_000 });
    expect(await queuePriority("user_pro")).toBe(1);
    expect(await billingState("user_pro")).toMatchObject({ usage: { usedSec: 0, allowanceSec: 400 * 60 } });
  });
});
