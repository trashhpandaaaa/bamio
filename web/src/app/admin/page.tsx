import type { Metadata } from "next";
import Link from "next/link";
import { formatPrice } from "@/lib/billing/plans";
import { listPriceMrr, overview, requireAdmin } from "@/lib/server/admin";
import { clipperCounts } from "@/lib/server/clippers";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "./admin-shell";
import { bytes, count, length } from "./format";
import styles from "./admin.module.css";

export const metadata: Metadata = { title: "Admin", robots: PRIVATE_PAGE };

/** How Bamio is doing right now: people, plans, projects, minutes, the queue, emails, disk. */
export default async function AdminOverviewPage() {
  const admin = await requireAdmin();
  const [o, clippers] = await Promise.all([overview(), clipperCounts()]);
  const paying = o.plans.reduce((n, p) => n + p.active, 0);
  const pastDue = o.plans.reduce((n, p) => n + p.pastDue, 0);
  const diskShare = o.disk && o.disk.totalBytes > 0 ? o.disk.freeBytes / o.disk.totalBytes : null;

  return (
    <AdminShell admin={admin} title="Overview" lede="Numbers as of this page load. Days and months are UTC.">
      <section className={styles.stats} aria-label="Numbers">
        <div className={styles.stat}>
          <span className={styles.kicker}>Users</span>
          <span className={styles.big}>{o.users ? count(o.users.total) : "—"}</span>
          <p>{o.users ? `${count(o.users.new7d)}${o.users.new7dMore ? "+" : ""} new in the last 7 days` : "Couldn’t reach Clerk"}</p>
        </div>
        <div className={styles.stat}>
          <span className={styles.kicker}>Paying</span>
          <span className={styles.big}>{count(paying)}</span>
          <p>
            {formatPrice(Math.round(listPriceMrr(o.plans)))} a month at list prices
            {pastDue > 0 ? <span className={styles.warn}> · {pastDue} payment due</span> : null}
          </p>
        </div>
        <div className={styles.stat}>
          <span className={styles.kicker}>Free plans</span>
          <span className={styles.big}>{count(o.grants)}</span>
          <p>Given by hand (plan_grants)</p>
        </div>
        <div className={styles.stat}>
          <span className={styles.kicker}>Clippers page</span>
          <span className={styles.big}>{count(clippers.approved)}</span>
          <p>
            {clippers.pending > 0 ? (
              <Link className={`${styles.cellLink} ${styles.warn}`} href="/admin/clippers">
                {count(clippers.pending)} waiting for a look
              </Link>
            ) : (
              "Nobody waiting"
            )}
          </p>
        </div>
        <div className={styles.stat}>
          <span className={styles.kicker}>Projects</span>
          <span className={styles.big}>{count(o.projects.total)}</span>
          <p>
            {count(o.projects.today)} today · {count(o.projects.week)} this week
          </p>
        </div>
        <div className={styles.stat}>
          <span className={styles.kicker}>AI minutes this month</span>
          <span className={styles.big}>{count(o.minutes.month)}</span>
          <p>{count(o.minutes.today)} today</p>
        </div>
        <div className={styles.stat}>
          <span className={styles.kicker}>Jobs</span>
          <span className={styles.big}>
            {count(o.jobs.running)} <span>running</span> {count(o.jobs.queued)} <span>waiting</span>
          </span>
          <p>
            {o.jobs.failed24h > 0 ? (
              <Link className={`${styles.cellLink} ${styles.bad}`} href="/admin/jobs?view=failed">
                {count(o.jobs.failed24h)} failed in 24 h
              </Link>
            ) : (
              "None failed in 24 h"
            )}
            {o.jobs.oldestWaitingSec >= 60 ? <span className={styles.warn}> · oldest waiting {length(o.jobs.oldestWaitingSec)}</span> : null}
          </p>
        </div>
        <div className={styles.stat}>
          <span className={styles.kicker}>Emails in 24 h</span>
          <span className={styles.big}>{count(o.emails.sent24h)}</span>
          <p>{o.emails.failed24h > 0 ? <span className={styles.bad}>{count(o.emails.failed24h)} failed</span> : "None failed"}</p>
        </div>
        <div className={styles.stat}>
          <span className={styles.kicker}>Disk free</span>
          <span className={`${styles.big} ${diskShare !== null && diskShare < 0.15 ? styles.warn : ""}`}>{o.disk ? bytes(o.disk.freeBytes) : "—"}</span>
          <p>
            {o.disk ? `of ${bytes(o.disk.totalBytes)} · ` : ""}media in {o.storage === "local" ? "this server’s disk" : `${o.storage} storage`}
          </p>
        </div>
      </section>
    </AdminShell>
  );
}
