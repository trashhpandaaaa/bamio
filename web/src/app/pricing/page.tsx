import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import Link from "next/link";
import { FaqList, faqPlain, type FaqItem } from "@/components/site/faq";
import { JsonLd } from "@/components/site/json-ld";
import { SiteFooter, SiteHeader, type SiteLink } from "@/components/site/site-chrome";
import { formatPrice, FREE_TRIAL, intervalSchema, planIdSchema, PLANS, quarterSaving } from "@/lib/billing/plans";
import { billingEnabled, billingState } from "@/lib/server/billing";
import { breadcrumbData, faqData, ORGANIZATION, pageMetadata, PRICING_DESCRIPTION, softwareData, WEBSITE } from "@/lib/site";
import { PricingPlans } from "./pricing-plans";
import styles from "./pricing.module.css";

export const metadata: Metadata = pageMetadata({
  title: `Pricing: AI clip maker plans from ${formatPrice(PLANS.starter.price.month)} a month`,
  description: PRICING_DESCRIPTION,
  path: "/pricing",
});

const LINKS: SiteLink[] = [
  { href: "/#how", label: "How it works" },
  { href: "/#captions", label: "Captions" },
  { href: "/#languages", label: "Languages" },
  { href: "/clippers", label: "Clippers" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

const FAQ: FaqItem[] = [
  {
    q: "Is anything free?",
    a: (
      <>
        Yes. The <Link href="/video-editor">video editor</Link>’s basics are free for every account, with no watermark: cutting, text, music, a voiceover and a 720p export. It runs in your
        browser, so it costs Bamio nothing to offer. Plans pay for what Bamio’s servers do (importing long videos, transcribing them and finding the clips with AI) and add the editor’s
        extras: 1080p, and with Pro silence removal, 60 fps and music that ducks under speech.
      </>
    ),
    text: "Yes. The video editor’s basics are free for every account, with no watermark: cutting, text, music, a voiceover and a 720p export. It runs in your browser, so it costs Bamio nothing to offer. Plans pay for what Bamio’s servers do (importing long videos, transcribing them and finding the clips with AI) and add the editor’s extras: 1080p, and with Pro silence removal, 60 fps and music that ducks under speech.",
  },
  {
    q: "What’s an AI processing minute?",
    a: "A minute of video Bamio imports: it transcribes every word and finds the clips. A 30-minute podcast uses 30 minutes; importing only part of a video uses only that part, and a followed live stream uses what’s captioned. Finding more clips, editing and exporting use none.",
  },
  {
    q: "What happens when I run out?",
    a: "Your projects and clips stay, and you can keep editing and exporting. New imports wait until your minutes renew, every month on the day you subscribed. Need more sooner? Upgrade, and the bigger allowance starts right away.",
  },
  {
    q: "Do unused minutes roll over?",
    a: "No. Each month starts with your plan’s full minutes.",
  },
  {
    q: "How do 3-month plans work?",
    a: `You pay for 3 months at once and save: ${formatPrice(PLANS.starter.price.quarter)} instead of ${formatPrice(PLANS.starter.price.month * 3)} on Starter, ${formatPrice(quarterSaving(PLANS.team))} off on Team. Your minutes still arrive every month, and the plan renews every 3 months.`,
  },
  {
    q: "Can I change or cancel my plan?",
    a: (
      <>
        Yes, any time, from <Link href="/billing">Plan &amp; billing</Link>. An upgrade starts right away and you pay only the difference; a smaller plan starts
        when your current period ends. If you cancel, your plan keeps working until the end of the period you paid for.
      </>
    ),
    text: "Yes, any time, from Plan & billing. An upgrade starts right away and you pay only the difference; a smaller plan starts when your current period ends. If you cancel, your plan keeps working until the end of the period you paid for.",
  },
  {
    q: "Can I try Bamio first?",
    a: `Yes. Your first video is free, up to ${FREE_TRIAL.minutes} minutes of it, with every feature and no watermark. You add a card to start: it’s only checked, never charged, and no plan starts by itself. One free video per card.`,
  },
  {
    q: "What does “coming soon” mean?",
    a: "Features Bamio is still building, shown under the plan that will include them. Everything listed as included works today.",
  },
  {
    q: "Is paying safe?",
    a: "Payments go through Stripe. Bamio never sees or stores your card.",
  },
];

/**
 * The plans. ?plan=&interval= (after signing up from here) opens checkout for that plan;
 * ?checkout=canceled says nothing was charged.
 */
export default async function PricingPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const { userId } = await auth();
  const enabled = billingEnabled();
  const state = userId && enabled ? await billingState(userId).catch(() => null) : null;
  const plan = planIdSchema.safeParse(params.plan);
  const interval = intervalSchema.safeParse(params.interval);

  return (
    <>
      <SiteHeader links={LINKS} current="/pricing" />
      <main id="main">
        <section className={`container ${styles.hero}`} aria-labelledby="pricing-title">
          <h1 id="pricing-title" className="t-display-xl">
            pick a plan, <span className="hl">start clipping.</span>
          </h1>
          <p className={styles.lede}>Every plan finds the moments, captions every word and exports 1080p with no watermark. Pay monthly, or every 3 months and save. Your first video is free.</p>
        </section>

        <section className="container" aria-label="Plans">
          <PricingPlans
            enabled={enabled}
            signedIn={Boolean(userId)}
            current={state?.active && state.plan && state.interval ? { plan: state.plan, interval: state.interval } : null}
            start={plan.success ? { plan: plan.data, interval: interval.success ? interval.data : "month" } : null}
            canceled={params.checkout === "canceled"}
          />
        </section>

        <section className={`container ${styles.faq}`} aria-labelledby="pricing-faq">
          <h2 id="pricing-faq" className="t-display-lg">
            billing, <span className="hl">answered.</span>
          </h2>
          <FaqList items={FAQ} name="pricing-faq" />
        </section>
      </main>
      <SiteFooter links={LINKS} />
      <JsonLd data={[ORGANIZATION, WEBSITE, softwareData(), faqData(faqPlain(FAQ)), breadcrumbData({ name: "Pricing", path: "/pricing" })]} />
    </>
  );
}
