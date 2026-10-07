import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/campaigns/parts";
import { formatPrice } from "@/lib/billing/plans";
import { REQUEST_KINDS } from "@/lib/campaigns/schema";
import { requireAdmin, usersById } from "@/lib/server/admin";
import { adminCampaignRequests } from "@/lib/server/campaign-requests";
import { adminCampaigns } from "@/lib/server/campaigns";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "../admin-shell";
import { ago, count, when } from "../format";
import { UserLink } from "../tables";
import { DeclineRequestButton } from "./campaign-controls";
import styles from "../admin.module.css";

export const metadata: Metadata = { title: "Campaigns · Admin", robots: PRIVATE_PAGE };

/**
 * Clipping campaigns for the people running them: requests from podcasters, streamers and
 * businesses to run one (make the campaign from a request, or decline it), then every
 * campaign, drafts too: what it pays, how much of its budget is used, clips waiting for a look
 * and what clippers are owed.
 */
export default async function AdminCampaignsPage() {
  const admin = await requireAdmin();
  const [campaigns, requests] = await Promise.all([adminCampaigns(), adminCampaignRequests()]);
  const users = await usersById(requests.map((r) => r.userId));
  const waiting = campaigns.reduce((n, c) => n + (c.status === "draft" ? 0 : c.waiting), 0);
  const owed = campaigns.reduce((n, c) => n + c.owedCents, 0);
  const asking = requests.filter((r) => r.status === "pending").length;

  return (
    <AdminShell
      admin={admin}
      title="Campaigns"
      lede={
        <>
          {asking > 0 ? `${count(asking)} ${asking === 1 ? "request" : "requests"} to run a campaign. ` : ""}
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
      {requests.length > 0 ? (
        <section className={styles.section} aria-labelledby="requests">
          <h2 id="requests">Requests to run a campaign</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>From</th>
                  <th>What they want clipped</th>
                  <th>Offer</th>
                  <th>Account</th>
                  <th>Answer</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <b>{r.name}</b>
                      <span className={styles.sub}>{REQUEST_KINDS[r.kind]}</span>
                      <a className={styles.subLink} href={r.sourceUrl} target="_blank" rel="noopener noreferrer">
                        {r.sourceUrl.replace(/^https:\/\/(www\.)?/, "").slice(0, 48)}
                      </a>
                    </td>
                    <td className={styles.roomy}>
                      <span className={styles.brief}>{r.brief}</span>
                    </td>
                    <td className={styles.roomy}>
                      {formatPrice(r.rateCents)} per 1,000 views
                      <span className={styles.sub}>{formatPrice(r.budgetCents)} budget</span>
                      <span className={styles.sub}>Pays by: {r.payout}</span>
                      {r.contact ? <span className={styles.sub}>Reach them: {r.contact}</span> : null}
                    </td>
                    <td className={styles.roomy}>
                      <UserLink id={r.userId} user={users.get(r.userId)} />
                      <span className={styles.sub} title={when(r.createdAt)}>
                        asked {ago(r.createdAt)}
                      </span>
                    </td>
                    {/* Where it stands and, while it waits, what to do with it: one column, so the table fits a desktop screen. */}
                    <td className={styles.roomy}>
                      {r.status === "pending" ? (
                        <span className="badge is-info">Waiting</span>
                      ) : r.status === "declined" ? (
                        <span className="badge">Declined</span>
                      ) : r.campaign ? (
                        <Link className={styles.cellLink} href={`/admin/campaigns/${r.campaign.id}`}>
                          {r.campaign.title}
                        </Link>
                      ) : (
                        <span className="badge">Its draft was deleted</span>
                      )}
                      {r.status === "declined" && r.note ? <span className={styles.sub}>{r.note}</span> : null}
                      {r.reviewedBy && r.status !== "pending" ? <span className={styles.sub}>by {r.reviewedBy}</span> : null}
                      {r.status === "pending" ? (
                        <div className={styles.cellActions}>
                          <Link className="btn btn-primary btn-sm" href={`/admin/campaigns/new?request=${r.id}`}>
                            Make the campaign
                          </Link>
                          <DeclineRequestButton id={r.id} name={r.name} />
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

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
