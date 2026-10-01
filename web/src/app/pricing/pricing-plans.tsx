"use client";

import { CaretDown, Check, CheckCircle, Clock, Info, Star, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useEffectEvent, useState } from "react";
import { formatPrice, PLAN_IDS, PLANS, quarterSaving, type Interval, type Plan, type PlanId } from "@/lib/billing/plans";
import { api } from "@/lib/clips/api";
import styles from "./pricing.module.css";

type Choice = { plan: PlanId; interval: Interval };

const MOST_SAVED = Math.max(...PLAN_IDS.map((id) => quarterSaving(PLANS[id])));

/**
 * The three plans with a monthly / every-3-months switch. What a plan's button does depends
 * on who's looking: sign up first, buy it (Stripe Checkout), or switch to it (Stripe's billing
 * portal) when another plan is already running. `start`: a plan picked before signing up,
 * whose checkout opens straight away.
 */
export function PricingPlans({
  enabled,
  signedIn,
  current,
  start,
  canceled,
}: {
  enabled: boolean;
  signedIn: boolean;
  current: Choice | null;
  start: Choice | null;
  canceled: boolean;
}) {
  const [period, setPeriod] = useState<Interval>(start?.interval ?? current?.interval ?? "month");
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(plan: PlanId, interval: Interval) {
    setBusy(plan);
    setError(null);
    try {
      const { url } = current ? await api.billingPortal({ plan, interval }) : await api.checkout(plan, interval);
      window.location.assign(url);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Couldn’t open checkout. Try again.");
    }
  }

  // Coming back to this page from Stripe (the browser's back button) shows it as it was left, mid-click.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  // Signed up from here with a plan picked: on to its checkout (the address loses the plan, so Back doesn't loop).
  const openStart = useEffectEvent((choice: Choice) => {
    window.history.replaceState(null, "", "/pricing");
    void go(choice.plan, choice.interval);
  });
  useEffect(() => {
    if (!start || !enabled || !signedIn || current) return;
    const timer = setTimeout(() => openStart(start), 250);
    return () => clearTimeout(timer);
  }, [start, enabled, signedIn, current]);

  function action(plan: Plan) {
    const label = plan.popular ? "btn btn-volt btn-lg" : "btn btn-primary btn-lg";
    if (!enabled) {
      return (
        <button className={`${label} ${styles.cta}`} type="button" disabled>
          Choose {plan.name}
        </button>
      );
    }
    if (!signedIn) {
      const back = `/pricing?plan=${plan.id}&interval=${period}`;
      return (
        <Link className={`${label} ${styles.cta}`} href={`/sign-up?redirect_url=${encodeURIComponent(back)}`}>
          Get {plan.name}
        </Link>
      );
    }
    if (current?.plan === plan.id && current.interval === period) {
      return (
        <p className={styles.current}>
          <CheckCircle size={18} weight="fill" aria-hidden /> Your plan
        </p>
      );
    }
    const text = !current
      ? `Choose ${plan.name}`
      : current.plan === plan.id
        ? period === "quarter"
          ? "Switch to every 3 months"
          : "Switch to monthly"
        : PLAN_IDS.indexOf(plan.id) > PLAN_IDS.indexOf(current.plan)
          ? `Upgrade to ${plan.name}`
          : `Switch to ${plan.name}`;
    return (
      <button className={`${label} ${styles.cta}`} type="button" onClick={() => void go(plan.id, period)} disabled={busy !== null} aria-busy={busy === plan.id}>
        {busy === plan.id ? "Opening Stripe…" : text}
      </button>
    );
  }

  return (
    <div className={styles.plans}>
      {!enabled || canceled || error ? (
        <div className={styles.notices}>
          {!enabled ? (
            <div className="notice is-warning">
              <WarningCircle size={20} weight="fill" aria-hidden />
              <p>
                <strong>Payments aren’t set up on this server</strong>
                Add <code>STRIPE_SECRET_KEY</code> to <code>web/.env</code>, run <code>npm run stripe:setup</code>, then restart. Until then everything is unlocked.
              </p>
            </div>
          ) : null}
          {canceled ? (
            <div className="notice">
              <Info size={20} aria-hidden />
              <p>
                <strong>Checkout cancelled</strong>
                Nothing was charged. Pick a plan whenever you’re ready.
              </p>
            </div>
          ) : null}
          {error ? (
            <div className="notice is-error" role="alert">
              <WarningCircle size={20} weight="fill" aria-hidden />
              <p>
                <strong>That didn’t work</strong>
                {error}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={styles.period}>
        <div className="seg" role="group" aria-label="Billing period">
          <button type="button" aria-pressed={period === "month"} onClick={() => setPeriod("month")}>
            Monthly
          </button>
          <button type="button" aria-pressed={period === "quarter"} onClick={() => setPeriod("quarter")}>
            Every 3 months
          </button>
        </div>
        <span className="badge is-success">Save up to {formatPrice(MOST_SAVED)}</span>
      </div>

      <div className={styles.grid}>
        {PLAN_IDS.map((id) => (
          <PlanCard key={id} plan={PLANS[id]} interval={period} isCurrent={current?.plan === id}>
            {action(PLANS[id])}
          </PlanCard>
        ))}
      </div>
      <p className={styles.small}>Prices in US dollars. Taxes may apply. Cancel any time; your plan runs to the end of the period you paid for.</p>
    </div>
  );
}

function PlanCard({ plan, interval, isCurrent, children }: { plan: Plan; interval: Interval; isCurrent: boolean; children: React.ReactNode }) {
  const included = plan.features.filter((f) => !f.soon);
  const soon = plan.features.filter((f) => f.soon);
  return (
    <article className={styles.card} data-popular={plan.popular ? "" : undefined} data-current={isCurrent ? "" : undefined} aria-labelledby={`plan-${plan.id}`}>
      <div className={styles.cardHead}>
        <h2 id={`plan-${plan.id}`} className={styles.name}>
          {plan.name}
        </h2>
        {plan.popular ? (
          <span className={`badge is-live ${styles.popular}`}>
            <Star size={14} weight="fill" aria-hidden /> Most popular
          </span>
        ) : null}
      </div>
      <p className={styles.tagline}>{plan.tagline}</p>

      <p className={styles.price}>
        <span className={styles.amount}>{formatPrice(plan.price[interval])}</span>
        <span className={styles.per}>{interval === "month" ? "/month" : "/3 months"}</span>
      </p>
      <p className={styles.note} data-saving={interval === "quarter" ? "" : undefined}>
        {interval === "quarter"
          ? `Save ${formatPrice(quarterSaving(plan))} compared to ${formatPrice(plan.price.month * 3)} monthly`
          : `Or ${formatPrice(plan.price.quarter)} every 3 months, and save ${formatPrice(quarterSaving(plan))}`}
      </p>

      {children}

      {plan.includes ? <p className={styles.includes}>Everything in {PLANS[plan.includes].name}, plus:</p> : null}
      <ul className={styles.features} aria-label={`${plan.name} includes`}>
        {included.map((f) => (
          <li key={f.text}>
            <span className={styles.tick} aria-hidden>
              <Check size={12} weight="bold" />
            </span>
            <span>
              {f.text}
              {f.detail ? <small>{f.detail}</small> : null}
            </span>
          </li>
        ))}
      </ul>

      {soon.length > 0 ? (
        <details className={styles.soon}>
          <summary>
            <Clock size={16} aria-hidden />
            Coming soon
            <span className={styles.count}>{soon.length}</span>
            <CaretDown size={16} weight="bold" aria-hidden className={styles.caret} />
          </summary>
          <ul aria-label={`Coming to ${plan.name}`}>
            {soon.map((f) => (
              <li key={f.text}>{f.text}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
