import { auth } from "@clerk/nextjs/server";
import { ArrowLeft, ArrowUpRight, LockSimple, Scissors } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { Budget, dayLabel, PLATFORM_ICONS, Platforms, rateLabel, StatusBadge } from "@/components/campaigns/parts";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { SITE_LINKS } from "@/components/site/use-case";
import { formatPrice } from "@/lib/billing/plans";
import { CHANNEL_PLATFORMS, CLIP_PLATFORMS } from "@/lib/campaigns/links";
import { compactNumber } from "@/lib/campaigns/money";
import type { Leader } from "@/lib/campaigns/schema";
import { adminOf } from "@/lib/server/admin";
import { campaignAccess, canSeeCampaigns } from "@/lib/server/campaign-access";
import { campaignBySlug, campaignRef, type CampaignPage } from "@/lib/server/campaigns";
import { PRIVATE_PAGE } from "@/lib/site";
import { CampaignPanel } from "./campaign-panel";
import styles from "../clippers.module.css";

type Props = { params: Promise<{ slug: string }> };

/** "locked": there is a campaign here, and this visitor may not see it. "owner": theirs, though they have no plan. */
type Loaded = { state: "missing" } | { state: "locked"; signedIn: boolean } | { state: "open"; page: CampaignPage; owner: boolean };

/**
 * The campaign, for the page and its metadata (one read for both), if this visitor may see it.
 * Campaigns are for subscribers (campaign-access.ts); everyone else gets the locked page, which
 * says nothing about the campaign. A draft shows only to admins, who look at it here before it
 * goes live.
 */
const load = cache(async (slug: string): Promise<Loaded> => {
  const ref = await campaignRef(slug);
  if (!ref) return { state: "missing" };
  const { userId } = await auth();
  if (ref.status === "draft" && !(userId && (await adminOf(userId)))) return { state: "missing" };
  const access = await campaignAccess(userId, ref.id);
  if (!canSeeCampaigns(access)) return { state: "locked", signedIn: Boolean(userId) };
  const page = await campaignBySlug(slug, { drafts: true });
  return page ? { state: "open", page, owner: access === "owner" } : { state: "missing" };
});

/** Campaign pages are for subscribers, so never for search engines; only someone who may see one gets its name in the tab. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const loaded = await load((await params).slug).catch(() => null);
  if (!loaded || loaded.state === "missing") return { title: "Campaign not found", robots: PRIVATE_PAGE };
  if (loaded.state === "locked") return { title: "A clipping campaign", robots: PRIVATE_PAGE };
  const c = loaded.page.campaign;
  return { title: `${c.title}: ${rateLabel(c.rateCents)}`, robots: PRIVATE_PAGE };
}

/** One campaign: what to clip, what it pays, how much budget is left, who has earned the most, and the clipper's own clips. For subscribers; others see the locked page. */
export default async function CampaignPageView({ params }: Props) {
  await connection();
  const slug = (await params).slug;
  const loaded = await load(slug);
  if (loaded.state === "missing") notFound();
  if (loaded.state === "locked") return <Locked slug={slug} signedIn={loaded.signedIn} />;
  const { campaign: c, leaders } = loaded.page;
  const byHand = c.platforms.filter((p) => !CLIP_PLATFORMS[p].counted).map((p) => CLIP_PLATFORMS[p].name);

  return (
    <>
      <SiteHeader links={SITE_LINKS} current="/clippers" />
      <main id="main">
        <section className={`container ${styles.head}`} aria-labelledby="campaign-title">
          <Link href="/clippers" className={styles.back}>
            <ArrowLeft size={16} aria-hidden />
            All campaigns
          </Link>
          {c.status === "draft" ? (
            <p className="notice is-warning" role="status">
              A draft: only admins see this page until the campaign goes live.
            </p>
          ) : null}
          <div className={styles.headTop}>
            <span className={styles.brand}>{c.brand}</span>
            <StatusBadge status={c.status} />
          </div>
          <h1 id="campaign-title" className="t-display-lg">
            {c.title}
          </h1>
          <p className={styles.lede}>{c.summary}</p>
        </section>

        <div className={`container ${styles.layout}`}>
          <aside className={styles.side} aria-label="Your place in this campaign">
            {loaded.owner ? (
              // They asked for this campaign and have no plan: they see it, and don't clip in it.
              <div className={styles.panel}>
                <h2 className="t-heading-md">Your campaign</h2>
                <p className={styles.panelText}>Clippers with a Bamio plan join here and send the clips they post. We look at each clip and count its views.</p>
                <p className={styles.panelText}>You pay Bamio for the campaign, and Bamio pays the clippers what their clips earn. We’ll write to you with what has been earned.</p>
              </div>
            ) : (
              <CampaignPanel slug={c.slug} brand={c.brand} status={c.status} platforms={c.platforms} />
            )}
          </aside>

          <div className={styles.body}>
            <dl className={styles.facts}>
              <div>
                <dt>Pays</dt>
                <dd className={styles.factBig}>{rateLabel(c.rateCents)}</dd>
              </div>
              <div>
                <dt>Budget</dt>
                <dd>
                  <Budget spentCents={c.stats.spentCents} budgetCents={c.budgetCents} />
                </dd>
              </div>
              <div>
                <dt>Post on</dt>
                <dd className={styles.factRow}>
                  <Platforms list={c.platforms} />
                  <span aria-hidden="true">{c.platforms.map((p) => CLIP_PLATFORMS[p].name).join(", ")}</span>
                </dd>
              </div>
              {c.minViews > 0 ? (
                <div>
                  <dt>A clip earns from</dt>
                  <dd>{c.minViews.toLocaleString("en-US")} views</dd>
                </div>
              ) : null}
              {c.maxClipCents !== null ? (
                <div>
                  <dt>Most one clip can earn</dt>
                  <dd>{formatPrice(c.maxClipCents)}</dd>
                </div>
              ) : null}
              {c.endsAt !== null ? (
                <div>
                  <dt>{c.status === "ended" ? "Ended" : "Ends"}</dt>
                  <dd>{dayLabel(c.endsAt)}</dd>
                </div>
              ) : null}
            </dl>

            <section className={styles.block} aria-labelledby="brief-title">
              <h2 id="brief-title" className="t-heading-md">
                What to clip
              </h2>
              {c.brief.split("\n").map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              {c.sourceUrl ? (
                <div className={styles.blockActions}>
                  <Link className="btn btn-primary" href={`/new?url=${encodeURIComponent(c.sourceUrl)}`}>
                    <Scissors size={18} aria-hidden />
                    Clip it with Bamio
                  </Link>
                  <a className="btn btn-secondary" href={c.sourceUrl} target="_blank" rel="noopener noreferrer">
                    Watch the content
                    <ArrowUpRight size={16} aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </div>
              ) : null}
            </section>

            {c.rules.length > 0 ? (
              <section className={styles.block} aria-labelledby="rules-title">
                <h2 id="rules-title" className="t-heading-md">
                  Rules
                </h2>
                <ul className={styles.rules}>
                  {c.rules.map((rule, i) => (
                    <li key={i}>{rule}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className={styles.block} aria-labelledby="pay-title">
              <h2 id="pay-title" className="t-heading-md">
                Getting paid
              </h2>
              {c.payout.split("\n").filter(Boolean).map((line, i) => (
                <p key={i}>{line}</p>
              ))}
              <p>
                Bamio pays clippers. {c.brand} pays Bamio for the campaign; Bamio counts the views, works out what each clip has earned, pays it and shows what has been paid.
              </p>
              <p>
                A clip counts once Bamio’s team has looked at it. Clips earn in the order they were approved, until the budget is used.{" "}
                {byHand.length === c.platforms.length
                  ? `Views on ${byHand.join(" and ")} are added by the team.`
                  : byHand.length > 0
                    ? `Views are counted a few times a day; on ${byHand.join(" and ")} the team adds them.`
                    : "Views are counted a few times a day."}
              </p>
            </section>

            <section className={styles.block} aria-labelledby="leaders-title">
              <h2 id="leaders-title" className="t-heading-md">
                Leaderboard
              </h2>
              {leaders.length === 0 ? (
                <p className={styles.quiet}>{c.status === "ended" ? "Nobody earned from this campaign." : "No clips are counting yet. The first approved clip takes the top spot."}</p>
              ) : (
                <ol className={styles.leaders}>
                  {leaders.map((l, i) => (
                    <LeaderRow key={i} leader={l} place={i + 1} />
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      </main>
      <SiteFooter links={SITE_LINKS} />
    </>
  );
}

/** For visitors who may not see campaigns: that there is one, and how to get in. Nothing about the campaign itself. */
function Locked({ slug, signedIn }: { slug: string; signedIn: boolean }) {
  return (
    <>
      <SiteHeader links={SITE_LINKS} current="/clippers" />
      <main id="main">
        <section className={`container ${styles.head} ${styles.lockedPage}`} aria-labelledby="locked-title">
          <Link href="/clippers" className={styles.back}>
            <ArrowLeft size={16} aria-hidden />
            Campaigns
          </Link>
          <div className="empty">
            <LockSimple size={32} aria-hidden />
            <h1 id="locked-title" className="empty-title">
              This campaign is for subscribers
            </h1>
            <p className="empty-body">With a Bamio plan you can see it, join, and earn for every 1,000 views on the clips you post.</p>
            <div className={styles.heroActions}>
              <Link href="/pricing" className="btn btn-volt">
                See plans
              </Link>
              {signedIn ? null : (
                <Link href={`/sign-in?redirect_url=${encodeURIComponent(`/clippers/${slug}`)}`} className="btn btn-secondary">
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </section>
      </main>
      <SiteFooter links={SITE_LINKS} />
    </>
  );
}

function LeaderRow({ leader: l, place }: { leader: Leader; place: number }) {
  const ChannelIcon = l.link ? PLATFORM_ICONS[l.link.platform] : null;
  return (
    <li className={styles.leader}>
      <span className={styles.place} aria-hidden="true">
        {place}
      </span>
      <span className="avatar" aria-hidden="true">
        {/* Their Clerk profile picture (a remote file whose size isn't known here). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {l.imageUrl ? <img src={l.imageUrl} alt="" width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : l.name.slice(0, 1).toUpperCase()}
      </span>
      <span className={styles.leaderWho}>
        <b>{l.name}</b>
        {l.link && ChannelIcon ? (
          // A link a user gave: search engines are told not to count it, and it opens apart from Bamio.
          <a className={styles.channel} href={l.link.url} target="_blank" rel="nofollow ugc noopener noreferrer">
            <ChannelIcon size={14} weight="fill" aria-hidden />
            <span className={styles.handle}>{l.link.handle}</span>
            <span className="sr-only">
              : {l.name} on {CHANNEL_PLATFORMS[l.link.platform].name} (opens in a new tab)
            </span>
          </a>
        ) : null}
      </span>
      <span className={styles.leaderNumbers}>
        <b>{formatPrice(l.earnedCents)}</b>
        <span>
          {compactNumber(l.views)} views · {l.clips} {l.clips === 1 ? "clip" : "clips"}
        </span>
      </span>
    </li>
  );
}
