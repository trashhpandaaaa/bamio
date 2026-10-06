import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/campaigns/parts";
import { formatPrice } from "@/lib/billing/plans";
import { requireAdmin } from "@/lib/server/admin";
import { adminCampaigns } from "@/lib/server/campaigns";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "../admin-shell";
import { ago, count, when } from "../format";
import styles from "../admin.module.css";

export const metadata: Metadata = { title: "Campaigns · Admin", robots: PRIVATE_PAGE };

/** Every clipping campaign, drafts too: what it pays, how much of its budget is used, clips waiting for a look and what clippers are owed. */
export default async function AdminCampaignsPage() {
  const admin = await requireAdmin();
  const campaigns = await adminCampaigns();
  const waiting = campaigns.reduce((n, c) => n + (c.status === "draft" ? 0 : c.waiting), 0);
  const owed = campaigns.reduce((n, c) => n + c.owedCents, 0);

  return (
    <AdminShell
      admin={admin}
      title="Campaigns"
      lede={
        <>
          {waiting === 0 ? "No clips are waiting for a look." : `${count(waiting)} ${waiting === 1 ? "clip is" : "clips are"} waiting for a look.`}{" "}
          {owed > 0 ? `${formatPrice(owed)} is owed to clippers. ` : ""}
          Clippers see open campaigns on the{" "}
          <Link className={styles.cellLink} href="/clippers">
            campaigns page
          </Link>
          .
        </>
      }
    >
      <section className={styles.section} aria-labelledby="all-campaigns">
        <div className={styles.sectionHead}>
          <h2 id="all-campaigns">All campaigns</h2>
          <Link className="btn btn-primary" href="/admin/campaigns/new">
            New campaign
          </Link>
        </div>
        {campaigns.length === 0 ? (
          <p className={styles.note}>No campaigns yet. Make one: it starts as a draft only admins see.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className={styles.num}>Per 1,000</th>
                  <th className={styles.num}>Budget used</th>
                  <th className={styles.num}>Clippers</th>
                  <th className={styles.num}>Clips</th>
                  <th className={styles.num}>Owed</th>
                  <th>Made</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className={styles.cellLink} href={`/admin/campaigns/${c.id}`}>
                        {c.title}
                      </Link>
                      <span className={styles.sub}>{c.brand}</span>
                    </td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className={styles.num}>{formatPrice(c.rateCents)}</td>
                    <td className={styles.num}>
                      {formatPrice(c.stats.spentCents)}
                      <span className={styles.sub}>of {formatPrice(c.budgetCents)}</span>
                    </td>
                    <td className={styles.num}>{count(c.stats.clippers)}</td>
                    <td className={styles.num}>
                      {count(c.stats.clips)}
                      {c.waiting > 0 ? <span className={`${styles.sub} ${styles.warn}`}>{count(c.waiting)} waiting</span> : null}
                    </td>
                    <td className={styles.num}>{c.owedCents > 0 ? formatPrice(c.owedCents) : "—"}</td>
                    <td className={styles.nowrap} title={when(c.createdAt)}>
                      {ago(c.createdAt)}
                      <span className={styles.sub}>{c.createdBy}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
