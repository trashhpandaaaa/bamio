import { auth } from "@clerk/nextjs/server";
import { ArrowRight, LockSimple } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Budget, Platforms, StatusBadge } from "@/components/campaigns/parts";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { SITE_LINKS } from "@/components/site/use-case";
import { formatPrice } from "@/lib/billing/plans";
import { compactNumber } from "@/lib/campaigns/money";
import type { CampaignCard } from "@/lib/campaigns/schema";
import { campaignAccess, canSeeCampaigns } from "@/lib/server/campaign-access";
import { listCampaigns, openCampaignCount } from "@/lib/server/campaigns";
import { pageMetadata } from "@/lib/site";
import { RunCampaign } from "./run-campaign";
import { YourCampaigns } from "./your-campaigns";
import styles from "./clippers.module.css";

const title = "Clipping campaigns: get paid per view for your clips";
const description = "Join a clipping campaign and earn for every 1,000 views on your clips. Podcasters, streamers and businesses: run one and pay clippers per view.";

export const metadata: Metadata = pageMetadata({ title, description, path: "/clippers", absoluteTitle: true });

const STEPS = [
  { title: "Pick a campaign", text: "Each one says what to clip, what it pays per 1,000 views and how much of its budget is left." },
  { title: "Clip it and post it", text: "Make your clips with Bamio and post them on your own channel: TikTok, Shorts, Reels or X." },
  { title: "Send the link", text: "Bamio counts the views on each clip. The campaign’s owner pays you directly, and you see what you’ve earned and been paid." },
];

/**
 * Clipping campaigns: the ones open now, how it works for clippers, how podcasters, streamers
 * and businesses run one (RunCampaign: a form that goes to Bamio's team, who set campaigns up
 * in the admin panel), and the finished ones. The campaigns themselves are for subscribers
 * (campaign-access.ts): everyone else sees that there are some and how to get in, and the
 * rest of the page. Read from the database and the session at request time, unlike the static
 * marketing pages. ?run=1 opens the form (back from signing in).
 */
export default async function ClippersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  const startRun = (await searchParams).run === "1";
  const { userId } = await auth();
  // With a plan: the campaigns. Without: only how many are open.
  const seen = await (async () => {
    const allowed = canSeeCampaigns(await campaignAccess(userId));
    return allowed ? { allowed, campaigns: await listCampaigns(), open: 0 } : { allowed, campaigns: [], open: await openCampaignCount() };
  })().catch(() => null);
  const running = seen?.campaigns.filter((c) => c.status !== "ended") ?? [];
  const finished = seen?.campaigns.filter((c) => c.status === "ended") ?? [];

  return (
    <>
      <SiteHeader links={SITE_LINKS} current="/clippers" />
      <main id="main">
        <section className={`container ${styles.hero}`} aria-labelledby="clippers-title">
          <h1 id="clippers-title" className="t-display-xl">
            get paid to <span className="hl">clip.</span>
          </h1>
          <p className={styles.lede}>Creators and brands put up a budget. You clip their content, post it on your own channel, and earn for every 1,000 views.</p>
          <div className={styles.heroActions}>
            <a href="#campaigns" className="btn btn-primary btn-lg">
              See the campaigns
            </a>
            <a href="#run" className="btn btn-secondary btn-lg">
              Run a campaign
            </a>
          </div>
        </section>

        {seen?.allowed ? <YourCampaigns /> : null}

        <section id="campaigns" className={`container ${styles.section}`} aria-labelledby="campaigns-title">
          <h2 id="campaigns-title" className="t-heading-xl">
            Campaigns
          </h2>
          {seen === null ? (
            <div className="empty" role="alert">
              <h3 className="empty-title">The campaigns couldn’t be loaded</h3>
              <p className="empty-body">Something went wrong on our side. Try again in a moment.</p>
            </div>
          ) : !seen.allowed ? (
            <div className="empty">
              <LockSimple size={32} aria-hidden />
              <h3 className="empty-title">Campaigns are for subscribers</h3>
              <p className="empty-body">
                {seen.open > 0 ? `${seen.open} ${seen.open === 1 ? "campaign is" : "campaigns are"} open right now. ` : ""}
                With a Bamio plan you can see every campaign, join, and earn for every 1,000 views on your clips.
              </p>
              <div className={styles.heroActions}>
                <Link href="/pricing" className="btn btn-volt">
                  See plans
                </Link>
                {userId ? null : (
                  <Link href={`/sign-in?redirect_url=${encodeURIComponent("/clippers")}`} className="btn btn-secondary">
                    Sign in
                  </Link>
                )}
              </div>
            </div>
          ) : running.length === 0 ? (
            <div className="empty">
              <span className="ai-mark" aria-hidden />
              <h3 className="empty-title">{finished.length > 0 ? "Nothing is open right now" : "The first campaigns are on their way"}</h3>
              <p className="empty-body">New campaigns show up here as they open. Until then, clip your own videos and get your channel ready.</p>
              <Link href="/new" className="btn btn-secondary">
                Make a clip
              </Link>
            </div>
          ) : (
            <ul className={styles.grid}>
              {running.map((c) => (
                <Card key={c.id} campaign={c} />
              ))}
            </ul>
          )}
        </section>

        <section className={`container ${styles.section}`} aria-labelledby="how-title">
          <h2 id="how-title" className="t-heading-xl">
            How clipping works
          </h2>
          <ol className={styles.steps}>
            {STEPS.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.number} aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="t-heading-sm">{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
          <p className={styles.small}>No money passes through Bamio. Each campaign’s page says who pays and how; Bamio keeps the count, so both sides see the same numbers.</p>
        </section>

        <RunCampaign startOpen={startRun} />

        {finished.length > 0 ? (
          <section className={`container ${styles.section}`} aria-labelledby="finished-title">
            <h2 id="finished-title" className="t-heading-xl">
              Finished
            </h2>
            <ul className={styles.grid}>
              {finished.map((c) => (
                <Card key={c.id} campaign={c} />
              ))}
            </ul>
          </section>
        ) : null}
        <div className={styles.end} />
      </main>
      <SiteFooter links={SITE_LINKS} />
    </>
  );
}

function Card({ campaign: c }: { campaign: CampaignCard }) {
  return (
    <li>
      <Link href={`/clippers/${c.slug}`} className={styles.card}>
        <div className={styles.cardTop}>
          <span className={styles.brand}>{c.brand}</span>
          <StatusBadge status={c.status} />
        </div>
        <div className={styles.cardWords}>
          <h3 className={styles.cardTitle}>{c.title}</h3>
          <p className={styles.cardSummary}>{c.summary}</p>
        </div>
        <p className={styles.rate}>
          <b>{formatPrice(c.rateCents)}</b> per 1,000 views
        </p>
        <Budget spentCents={c.stats.spentCents} budgetCents={c.budgetCents} />
        <div className={styles.cardFoot}>
          <Platforms list={c.platforms} />
          <span>
            {c.stats.clippers === 0 ? "No clippers yet" : `${compactNumber(c.stats.clippers)} ${c.stats.clippers === 1 ? "clipper" : "clippers"}`}
            {c.stats.views > 0 ? ` · ${compactNumber(c.stats.views)} views` : ""}
          </span>
          <ArrowRight size={18} aria-hidden className={styles.arrow} />
        </div>
      </Link>
    </li>
  );
}
