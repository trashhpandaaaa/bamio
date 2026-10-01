"use client";

import { ArrowSquareOut, Clock, CreditCard, FolderSimple, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { useBilling } from "@/hooks/use-billing";
import { formatPrice, minutesLeft, PLANS, usedMinutes, type BillingState } from "@/lib/billing/plans";
import { api } from "@/lib/clips/api";
import styles from "./billing.module.css";

const formatDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

/** Stripe's subscription status, for people. */
function statusBadge(billing: BillingState) {
  if (billing.status === "past_due") return <span className="badge is-warning">Payment due</span>;
  if (billing.active && billing.ending) return <span className="badge is-warning">Ending</span>;
  if (billing.active) return <span className="badge is-success">Active</span>;
  if (billing.status === "canceled") return <span className="badge">Ended</span>;
  if (billing.status === "paused") return <span className="badge">Paused</span>;
  return <span className="badge is-error">Payment needed</span>;
}

/**
 * Plan & billing: the plan and its renewal, this month's AI minutes, projects kept, and the
 * way to Stripe's billing portal (change plan, card, invoices, cancel). Reads the plan from
 * Stripe as it opens, since people arrive here back from Checkout and the portal.
 */
export function BillingView({ arrived }: { arrived: "checkout" | "changed" | null }) {
  const toast = useToast();
  const { billing, error, refresh } = useBilling({ fresh: true });
  const [opening, setOpening] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const welcomed = useRef(false);

  // Back from Checkout or a plan switch: drop the note from the address, and say so once the plan works.
  useEffect(() => {
    if (!billing || !arrived || welcomed.current) return;
    window.history.replaceState(null, "", "/billing");
    if (!billing.active || !billing.plan) return;
    welcomed.current = true;
    toast({ tone: "success", title: arrived === "checkout" ? `Welcome to ${PLANS[billing.plan].name}` : `You’re on ${PLANS[billing.plan].name} now`, body: "Your AI minutes are ready to use." });
  }, [billing, arrived, toast]);

  async function openPortal() {
    setOpening(true);
    setPortalError(null);
    try {
      window.location.assign((await api.billingPortal()).url);
    } catch (err) {
      setOpening(false);
      setPortalError(err instanceof Error ? err.message : "Couldn’t open billing. Try again.");
    }
  }

  // Back from the portal with the browser's back button: the page comes back as it was left.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setOpening(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const manage = billing?.canManage ? (
    <button className="btn btn-primary" type="button" onClick={() => void openPortal()} disabled={opening} aria-busy={opening}>
      <CreditCard size={18} aria-hidden /> {opening ? "Opening Stripe…" : "Manage billing"}
    </button>
  ) : null;

  return (
    <main id="main" className={`container ${styles.page}`}>
      <div className={styles.head}>
        <h1 className="t-heading-xl">Plan &amp; billing</h1>
        <p className="t-secondary">Your plan, this month’s AI minutes, and your invoices.</p>
      </div>

      {error ? (
        <div className="notice is-error" role="alert">
          <WarningCircle size={20} weight="fill" aria-hidden />
          <p>
            <strong>Couldn’t load your plan</strong>
            {error.message}
          </p>
          <button className="btn btn-secondary btn-sm" type="button" onClick={refresh} style={{ marginLeft: "auto" }}>
            Try again
          </button>
        </div>
      ) : null}
      {portalError ? (
        <div className="notice is-error" role="alert">
          <WarningCircle size={20} weight="fill" aria-hidden />
          <p>
            <strong>Couldn’t open billing</strong>
            {portalError}
          </p>
        </div>
      ) : null}

      {!billing ? (
        error ? null : (
          <div className={styles.grid} aria-busy="true" aria-label="Loading your plan">
            <div className={`skeleton ${styles.skeletonPlan}`} />
            <div className={`skeleton ${styles.skeletonCard}`} />
            <div className={`skeleton ${styles.skeletonCard}`} />
          </div>
        )
      ) : !billing.enabled ? (
        <div className="empty">
          <span className="ai-mark" aria-hidden />
          <h2 className="empty-title">Plans aren’t set up on this server</h2>
          <p className="empty-body">
            Everything is unlocked. To sell plans, add <code>STRIPE_SECRET_KEY</code> to <code>web/.env</code>, run <code>npm run stripe:setup</code>, then restart.
          </p>
          <Link href="/pricing" className="btn btn-secondary">
            See the plans
          </Link>
        </div>
      ) : !billing.plan ? (
        <div className="empty">
          <span className="ai-mark" aria-hidden />
          <h2 className="empty-title">No plan yet</h2>
          <p className="empty-body">Choose a plan to import videos. Bamio finds the moments, captions every word and exports 1080p with no watermark.</p>
          <Link href="/pricing" className="btn btn-volt">
            See the plans
          </Link>
        </div>
      ) : (
        <>
          {billing.status === "past_due" ? (
            <div className="notice is-warning" role="status">
              <WarningCircle size={20} weight="fill" aria-hidden />
              <p>
                <strong>Your last payment didn’t go through</strong>
                Stripe will try again. Update your card in Manage billing to keep your plan.
              </p>
            </div>
          ) : null}
          {arrived === "checkout" && !billing.active && billing.status === "incomplete" ? (
            <div className="notice" role="status">
              <Clock size={20} aria-hidden />
              <p>
                <strong>Your payment is processing</strong>
                Your plan starts as soon as Stripe confirms it.
              </p>
              <button className="btn btn-secondary btn-sm" type="button" onClick={refresh} style={{ marginLeft: "auto" }}>
                Check again
              </button>
            </div>
          ) : null}

          <div className={styles.grid}>
            <PlanPanel billing={billing} manage={manage} />
            {billing.usage ? <MinutesPanel usage={billing.usage} /> : null}
            {billing.active ? <ProjectsPanel projects={billing.projects} /> : null}
          </div>
        </>
      )}
    </main>
  );
}

function PlanPanel({ billing, manage }: { billing: BillingState; manage: React.ReactNode }) {
  const plan = PLANS[billing.plan!];
  const interval = billing.interval ?? "month";
  return (
    <section className={`${styles.panel} ${styles.planPanel}`} aria-labelledby="plan-title">
      <p className={styles.kicker}>Your plan</p>
      <div className={styles.planHead}>
        <h2 id="plan-title" className="t-heading-lg">
          {plan.name}
        </h2>
        {statusBadge(billing)}
      </div>
      <p className={styles.price}>
        <b>{formatPrice(plan.price[interval])}</b> {interval === "month" ? "a month" : "every 3 months"}
      </p>
      {billing.periodEnd ? (
        <p className="t-body-sm t-secondary">
          {!billing.active
            ? `Ended on ${formatDate(billing.periodEnd)}.`
            : billing.ending
              ? `Ends on ${formatDate(billing.periodEnd)}. You can keep it from Manage billing.`
              : `Renews on ${formatDate(billing.periodEnd)}.`}
        </p>
      ) : null}
      <div className={styles.actions}>
        {billing.active ? (
          manage
        ) : (
          <Link href="/pricing" className="btn btn-volt">
            Choose a plan
          </Link>
        )}
        <Link href="/pricing" className="btn btn-secondary">
          Compare plans
        </Link>
      </div>
      {manage ? (
        <p className={styles.small}>
          <ArrowSquareOut size={14} aria-hidden /> Manage billing opens Stripe: change your plan, update your card, get invoices or cancel.
        </p>
      ) : null}
    </section>
  );
}

function MinutesPanel({ usage }: { usage: NonNullable<BillingState["usage"]> }) {
  const left = minutesLeft(usage);
  const allowance = Math.round(usage.allowanceSec / 60);
  const used = Math.min(allowance, usedMinutes(usage.usedSec));
  const pct = allowance > 0 ? Math.min(100, (usage.usedSec / usage.allowanceSec) * 100) : 100;
  return (
    <section className={styles.panel} aria-labelledby="minutes-title">
      <p id="minutes-title" className={styles.kicker}>
        AI minutes this month
      </p>
      <p className={styles.big}>
        {left.toLocaleString()} <span>of {allowance.toLocaleString()} left</span>
      </p>
      <div className={`progress ${styles.meter}`} data-low={left < allowance * 0.1 ? "" : undefined} role="progressbar" aria-label="AI minutes used" aria-valuemin={0} aria-valuemax={allowance} aria-valuenow={used}>
        <span style={{ "--value": `${Math.max(pct, used > 0 ? 2 : 0)}%` } as React.CSSProperties} />
      </div>
      <p className="t-body-sm t-secondary">
        {used.toLocaleString()} used. More arrive on {formatDate(usage.resetsAt)}.
      </p>
      {left === 0 ? (
        <p className={styles.out}>
          Out of minutes. <Link href="/pricing">Upgrade</Link> to import more now.
        </p>
      ) : null}
    </section>
  );
}

function ProjectsPanel({ projects }: { projects: BillingState["projects"] }) {
  const pct = projects.limit > 0 ? Math.min(100, (projects.count / projects.limit) * 100) : 100;
  return (
    <section className={styles.panel} aria-labelledby="projects-title">
      <p id="projects-title" className={styles.kicker}>
        Projects
      </p>
      <p className={styles.big}>
        {projects.count.toLocaleString()} <span>of {projects.limit.toLocaleString()} kept</span>
      </p>
      <div className={`progress ${styles.meter}`} role="progressbar" aria-label="Projects kept" aria-valuemin={0} aria-valuemax={projects.limit} aria-valuenow={projects.count}>
        <span style={{ "--value": `${Math.max(pct, projects.count > 0 ? 2 : 0)}%` } as React.CSSProperties} />
      </div>
      <p className="t-body-sm t-secondary">
        <FolderSimple size={14} aria-hidden className={styles.inlineIcon} /> Delete projects you’re done with to make room.{" "}
        <Link href="/projects" className="link">
          Your projects
        </Link>
      </p>
    </section>
  );
}
