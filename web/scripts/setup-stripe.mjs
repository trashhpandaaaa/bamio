#!/usr/bin/env node
/*
 * Sets up Bamio's plans in your Stripe account (test or live, whichever the key is for):
 * a product per plan, a monthly and a 3-month price for each (found by lookup key), and the
 * billing portal settings that let people switch between them. Safe to run again: what's
 * there is reused, and a price whose amount changed in src/lib/billing/plans.ts is replaced
 * (the old one is archived; subscriptions on it keep working).
 *   npm run stripe:setup
 *   npm run stripe:setup -- --webhook https://your.domain   also adds the webhook endpoint (production)
 * Reads web/.env and web/.env.local the same way Next.js does.
 */
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import Stripe from "stripe";

const root = fileURLToPath(new URL("..", import.meta.url));
nextEnv.loadEnvConfig(root);
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("✗ No STRIPE_SECRET_KEY found. Add it to web/.env or web/.env.local (see .env.example).");
  process.exit(1);
}

let catalog;
try {
  // The plans themselves, straight from the app (Node reads the TypeScript file).
  catalog = await import("../src/lib/billing/plans.ts");
} catch (err) {
  console.error(`✗ Couldn’t read src/lib/billing/plans.ts (${err.message}). This script needs Node 22.18 or newer.`);
  process.exit(1);
}
const { PLANS, PLAN_IDS, INTERVALS, lookupKey, formatPrice } = catalog;

const webhookArg = process.argv.indexOf("--webhook");
const webhookBase = webhookArg > 0 ? process.argv[webhookArg + 1] : undefined;
if (webhookArg > 0 && !/^https:\/\/[^/\s]+/.test(webhookBase ?? "")) {
  console.error("✗ --webhook needs your site's https address, like --webhook https://bamio.example.com");
  process.exit(1);
}

/** Events the app listens to (src/lib/server/billing.ts, handleWebhook). */
const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.pending_update_applied",
  "customer.subscription.pending_update_expired",
  // A referred user's first payment earns their referrer credit (billing.ts settleReferral).
  "invoice.paid",
];

const stripe = new Stripe(key, { maxNetworkRetries: 2 });
const live = /^(sk|rk)_live_/.test(key);
console.log(`Stripe, ${live ? "LIVE mode: real payments" : "test mode"}\n`);

const all = async (list) => {
  const items = [];
  for await (const item of list) items.push(item);
  return items;
};

try {
  const products = await all(stripe.products.list({ limit: 100 }));
  const productIds = {};
  const priceIds = {};

  for (const id of PLAN_IDS) {
    const plan = PLANS[id];
    const name = `Bamio ${plan.name}`;
    let product = products.find((p) => p.metadata?.bamio_plan === id && p.active) ?? products.find((p) => p.metadata?.bamio_plan === id);
    if (!product) {
      product = await stripe.products.create({ name, description: plan.tagline, metadata: { bamio_plan: id } });
    } else if (!product.active || product.name !== name || product.description !== plan.tagline) {
      product = await stripe.products.update(product.id, { active: true, name, description: plan.tagline });
    }
    productIds[id] = product.id;

    const line = [];
    for (const interval of INTERVALS) {
      const lookup = lookupKey(id, interval);
      const amount = plan.price[interval];
      const months = interval === "quarter" ? 3 : 1;
      const [existing] = (await stripe.prices.list({ lookup_keys: [lookup], limit: 1 })).data;
      const fits =
        existing &&
        existing.active &&
        existing.product === product.id &&
        existing.currency === "usd" &&
        existing.unit_amount === amount &&
        existing.recurring?.interval === "month" &&
        existing.recurring?.interval_count === months;
      let price = existing;
      if (!fits) {
        price = await stripe.prices.create({
          product: product.id,
          currency: "usd",
          unit_amount: amount,
          recurring: { interval: "month", interval_count: months },
          nickname: `${plan.name}, ${interval === "month" ? "monthly" : "every 3 months"}`,
          lookup_key: lookup,
          transfer_lookup_key: true,
          // Kept when a price is replaced, so subscriptions on the old one are still recognized.
          metadata: { bamio_plan: id, bamio_interval: interval },
        });
        if (existing && existing.active) await stripe.prices.update(existing.id, { active: false });
      }
      priceIds[lookup] = price.id;
      line.push(`${interval === "month" ? "monthly" : "every 3 months"} ${formatPrice(amount)}${fits ? "" : " (new)"}`);
    }
    if (product.default_price !== priceIds[lookupKey(id, "month")]) await stripe.products.update(product.id, { default_price: priceIds[lookupKey(id, "month")] });
    console.log(`✓ ${plan.name.padEnd(8)} ${line.join(", ")}`);
  }

  // The billing portal: switch between the plans (upgrades now, paying the difference; smaller plans and
  // shorter periods at the end of the period paid for), update the card, see invoices, cancel at period end.
  const portal = {
    business_profile: { headline: "Bamio: your plan and invoices" },
    features: {
      customer_update: { enabled: true, allowed_updates: ["email", "name", "address", "tax_id"] },
      invoice_history: { enabled: true },
      payment_method_update: { enabled: true },
      subscription_cancel: {
        enabled: true,
        mode: "at_period_end",
        cancellation_reason: { enabled: true, options: ["too_expensive", "missing_features", "switched_service", "unused", "other"] },
      },
      subscription_update: {
        enabled: true,
        default_allowed_updates: ["price"],
        products: PLAN_IDS.map((id) => ({ product: productIds[id], prices: INTERVALS.map((interval) => priceIds[lookupKey(id, interval)]) })),
        proration_behavior: "always_invoice",
        schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }, { type: "shortening_interval" }] },
      },
    },
    metadata: { bamio: "portal" },
  };
  const configs = await all(stripe.billingPortal.configurations.list({ limit: 100, active: true }));
  const mine = configs.find((c) => c.metadata?.bamio === "portal");
  const config = mine ? await stripe.billingPortal.configurations.update(mine.id, portal) : await stripe.billingPortal.configurations.create(portal);
  console.log(`✓ Billing portal ${config.id}${mine ? "" : " (new)"}`);

  if (webhookBase) {
    const url = `${webhookBase.replace(/\/+$/, "")}/api/billing/webhook`;
    const endpoints = await all(stripe.webhookEndpoints.list({ limit: 100 }));
    const found = endpoints.find((e) => e.url === url);
    if (found) {
      await stripe.webhookEndpoints.update(found.id, { enabled_events: EVENTS, disabled: false });
      console.log(`✓ Webhook ${url} (kept its signing secret: find it in the Stripe dashboard under Developers, Webhooks)`);
    } else {
      const created = await stripe.webhookEndpoints.create({ url, enabled_events: EVENTS, description: "Bamio plans" });
      console.log(`✓ Webhook ${url}\n  Put its signing secret in web/.env: STRIPE_WEBHOOK_SECRET=${created.secret}`);
    }
  }

  console.log(`
Next:
  1. Webhook. On this computer, with the Stripe CLI:
       stripe listen --forward-to localhost:3000/api/billing/webhook
     and put the whsec_... it prints in web/.env as STRIPE_WEBHOOK_SECRET.
     In production: npm run stripe:setup -- --webhook https://your.domain
  2. Restart the server. Plans show on /pricing; test cards: https://docs.stripe.com/testing`);
} catch (err) {
  if (err instanceof Stripe.errors.StripeAuthenticationError) console.error("✗ Stripe refused the key. Check STRIPE_SECRET_KEY in web/.env.");
  else console.error(`✗ ${err.message ?? err}`);
  process.exit(1);
}
