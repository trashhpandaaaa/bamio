import { ArrowUpRight } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { dayLabel, PLATFORM_ICONS, rateLabel, StatusBadge } from "@/components/campaigns/parts";
import { formatPrice } from "@/lib/billing/plans";
import { channelLink, CLIP_PLATFORMS } from "@/lib/campaigns/links";
import { requireAdmin, usersById } from "@/lib/server/admin";
import { adminCampaign, type AdminClip } from "@/lib/server/campaigns";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "../../admin-shell";
import { ago, count, when } from "../../format";
import { UserLink } from "../../tables";
import { BlockButton, CampaignStatusActions, ClipActions, PayoutButton } from "../campaign-controls";
import styles from "../../admin.module.css";

export const metadata: Metadata = { title: "Campaign · Admin", robots: PRIVATE_PAGE };

const CLIP_BADGE = { pending: ["is-info", "Waiting"], approved: ["is-success", "Counting"], rejected: ["is-error", "Rejected"] } as const;

/** Where a clip's view count comes from, and how fresh it is. */
function viewsNote(c: AdminClip): string {
  if (c.byHand !== null) return c.counted !== null ? `typed in · Bamio read ${count(c.counted)}` : "typed in";
  if (!CLIP_PLATFORMS[c.platform].counted) return "needs typing in";
  if (c.checkedAt === null) return "not counted yet";
  return `read ${ago(c.checkedAt)}`;
}

/**
 * One campaign, for the people running it: open or end it, look at the clips sent in (those
 * waiting first), see what each clipper has earned and is owed, and write down payments made
 * to them outside Bamio.
 */
export default async function AdminCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const found = await adminCampaign((await params).id);
  if (!found) notFound();
  const { campaign: c, clips, clippers, payouts } = found;
  const users = await usersById([...clippers.map((k) => k.userId), ...clips.map((k) => k.userId)]);
  const waiting = clips.filter((k) => k.status === "pending").length;
  const owed = clippers.reduce((n, k) => n + k.owedCents, 0);
  const paid = payouts.reduce((n, p) => n + p.amountCents, 0);

  return (
    <AdminShell
      admin={admin}
      title={c.title}
      lede={
        <>
          {c.brand} · {rateLabel(c.rateCents)}
          {c.minViews > 0 ? ` from ${count(c.minViews)} views` : ""}
          {c.maxClipCents !== null ? `, up to ${formatPrice(c.maxClipCents)} a clip` : ""}
          {c.endsAt !== null ? ` · last day ${dayLabel(c.endsAt)}` : ""}
        </>
      }
    >
      <section className={styles.section} aria-label="Status">
        <div className={styles.sectionHead}>
          <div className={styles.inline}>
            <StatusBadge status={c.status} />
            <Link className={styles.cellLink} href={`/clippers/${c.slug}`}>
              {c.status === "draft" ? "Preview its page" : "Its public page"}
            </Link>
            <Link className={styles.cellLink} href={`/admin/campaigns/${c.id}/edit`}>
              Edit
            </Link>
            <Link className={styles.cellLink} href="/admin/campaigns">
              All campaigns
            </Link>
          </div>
          <CampaignStatusActions id={c.id} title={c.title} status={c.status} />
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.kicker}>Budget used</span>
            <span className={styles.big}>{formatPrice(found.spentCents)}</span>
            <p>
              of {formatPrice(c.budgetCents)} · {formatPrice(found.leftCents)} left
            </p>
          </div>
          <div className={styles.stat}>
            <span className={styles.kicker}>Owed to clippers</span>
            <span className={`${styles.big} ${owed > 0 ? styles.warn : ""}`}>{formatPrice(owed)}</span>
            <p>{formatPrice(paid)} paid so far</p>
          </div>
          <div className={styles.stat}>
            <span className={styles.kicker}>Views that count</span>
            <span className={styles.big}>{count(found.views)}</span>
            <p>
              {count(clips.filter((k) => k.status === "approved").length)} approved {clips.filter((k) => k.status === "approved").length === 1 ? "clip" : "clips"}
            </p>
          </div>
          <div className={styles.stat}>
            <span className={styles.kicker}>Clippers</span>
            <span className={styles.big}>{count(clippers.length)}</span>
            <p>{waiting > 0 ? <span className={styles.warn}>{`${count(waiting)} ${waiting === 1 ? "clip" : "clips"} waiting for a look`}</span> : "No clips waiting"}</p>
          </div>
        </div>
      </section>

      <section className={styles.section} aria-labelledby="clips-title">
        <h2 id="clips-title">Clips</h2>
        {clips.length === 0 ? (
          <p className={styles.note}>No clips sent yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Clip</th>
                  <th>Clipper</th>
                  <th>Status</th>
                  <th className={styles.num}>Views</th>
                  <th className={styles.num}>Earned</th>
                  <th>Sent</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {clips.map((k) => {
                  const PlatformIcon = PLATFORM_ICONS[k.platform];
                  const [tone, label] = CLIP_BADGE[k.status];
                  const channel = k.channel ? channelLink(k.channel) : null;
                  return (
                    <tr key={k.id}>
                      <td>
                        <a className={styles.clipLink} href={k.url} target="_blank" rel="noopener noreferrer">
                          <PlatformIcon size={16} weight="fill" aria-hidden />
                          <span>{k.title ?? k.url.replace(/^https:\/\/(www\.)?/, "")}</span>
                          <ArrowUpRight size={14} aria-hidden />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                        {k.author ? <span className={styles.sub}>posted by {k.author}</span> : null}
                        {k.error ? <span className={styles.error}>{k.error}</span> : null}
                      </td>
                      <td className={styles.roomy}>
                        {k.name}
                        {k.blocked ? <span className={`${styles.sub} ${styles.bad}`}>blocked</span> : null}
                        <span className={styles.sub}>{channel ? channel.url.replace("https://", "") : "no channel"}</span>
                      </td>
                      <td className={styles.roomy}>
                        <span className={`badge ${tone}`}>{label}</span>
                        {k.status === "rejected" && k.note ? <span className={styles.sub}>{k.note}</span> : null}
                        {k.reviewedBy && k.status !== "pending" ? <span className={styles.sub}>by {k.reviewedBy}</span> : null}
                      </td>
                      <td className={styles.num}>
                        {count(k.views)}
                        <span className={styles.sub}>{viewsNote(k)}</span>
                      </td>
                      <td className={styles.num}>{k.status === "approved" ? formatPrice(k.earnedCents) : "—"}</td>
                      <td className={styles.nowrap} title={when(k.createdAt)}>
                        {ago(k.createdAt)}
                      </td>
                      <td>
                        <ClipActions clipId={k.id} who={k.name} status={k.status} platform={k.platform} views={k.views} byHand={k.byHand} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="clippers-title">
        <h2 id="clippers-title">Clippers and what they’re owed</h2>
        {clippers.length === 0 ? (
          <p className={styles.note}>Nobody has joined yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Clipper</th>
                  <th>Account</th>
                  <th className={styles.num}>Clips</th>
                  <th className={styles.num}>Views</th>
                  <th className={styles.num}>Earned</th>
                  <th className={styles.num}>Paid</th>
                  <th className={styles.num}>Owed</th>
                  <th>Pay them by</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {clippers.map((k) => {
                  const channel = k.link ? channelLink(k.link) : null;
                  return (
                    <tr key={k.userId}>
                      <td>
                        <span className={styles.person}>
                          <span className="avatar" aria-hidden="true">
                            {/* Their Clerk profile picture. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {k.imageUrl ? <img src={k.imageUrl} alt="" width={32} height={32} loading="lazy" referrerPolicy="no-referrer" /> : k.name.slice(0, 1).toUpperCase()}
                          </span>
                          <b>{k.name}</b>
                        </span>
                        {k.blocked ? <span className={`${styles.sub} ${styles.bad}`}>blocked</span> : null}
                        {channel ? (
                          <a className={styles.subLink} href={channel.url} target="_blank" rel="noopener noreferrer">
                            {channel.url.replace("https://", "")}
                          </a>
                        ) : null}
                      </td>
                      <td className={styles.roomy}>
                        <UserLink id={k.userId} user={users.get(k.userId)} />
                        <span className={styles.sub} title={when(k.joinedAt)}>
                          joined {ago(k.joinedAt)}
                        </span>
                      </td>
                      <td className={styles.num}>
                        {count(k.clips)}
                        {k.waiting > 0 ? <span className={`${styles.sub} ${styles.warn}`}>{count(k.waiting)} waiting</span> : null}
                      </td>
                      <td className={styles.num}>{count(k.views)}</td>
                      <td className={styles.num}>{formatPrice(k.earnedCents)}</td>
                      <td className={styles.num}>{formatPrice(k.paidCents)}</td>
                      <td className={`${styles.num} ${k.owedCents > 0 ? styles.warn : ""}`}>{formatPrice(k.owedCents)}</td>
                      <td className={styles.roomy}>{k.payout ? <span className={styles.mono}>{k.payout}</span> : <span className="t-tertiary">Not given yet</span>}</td>
                      <td>
                        <div className={styles.rowActions}>
                          <PayoutButton campaignId={c.id} userId={k.userId} name={k.name} owedCents={k.owedCents} payout={k.payout} />
                          <BlockButton userId={k.userId} name={k.name} blocked={k.blocked} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="payouts-title">
        <h2 id="payouts-title">Payments recorded</h2>
        {payouts.length === 0 ? (
          <p className={styles.note}>None yet. Pay a clipper outside Bamio, then use Mark paid beside their name: they’re emailed, and what they’re owed goes down.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Clipper</th>
                  <th className={styles.num}>Amount</th>
                  <th>Note</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name ?? <span className="t-tertiary">Someone who has left</span>}</td>
                    <td className={styles.num}>{formatPrice(p.amountCents)}</td>
                    <td className={styles.roomy}>{p.note || <span className="t-tertiary">None</span>}</td>
                    <td className={styles.nowrap} title={when(p.paidAt)}>
                      {ago(p.paidAt)}
                      <span className={styles.sub}>by {p.paidBy}</span>
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
