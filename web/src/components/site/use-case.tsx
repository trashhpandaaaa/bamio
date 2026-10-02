import { ArrowRight, UploadSimple } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { LinkForm } from "@/components/landing/link-form";
import { FaqList, faqPlain, type FaqItem } from "@/components/site/faq";
import { JsonLd } from "@/components/site/json-ld";
import { SiteFooter, SiteHeader, type SiteLink } from "@/components/site/site-chrome";
import { breadcrumbData, faqData, ORGANIZATION, SITE_URL, softwareData, USE_CASES, WEBSITE } from "@/lib/site";
import styles from "./use-case.module.css";

/*
 * A page for one thing people search for ("YouTube to Shorts", "podcast clips"...): what Bamio
 * does for it, in three steps, the details that matter, questions, and the link field. Each page
 * passes its own words; this lays them out and adds the structured data.
 */

export const SITE_LINKS: SiteLink[] = [
  { href: "/#how", label: "How it works" },
  { href: "/#captions", label: "Captions" },
  { href: "/#languages", label: "Languages" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

export type UseCase = {
  path: (typeof USE_CASES)[number]["href"];
  /** The short name, for breadcrumbs and the label above the headline. */
  name: string;
  /** The headline: plain words, then the highlighted ending. */
  headline: [string, string];
  lede: string;
  /** A demo from the landing page. */
  visual: ReactNode;
  steps: { title: string; text: string }[];
  details: { title: string; text: string }[];
  faq: FaqItem[];
  /** Under the demo, for stock footage it shows. */
  credit?: string;
};

export function UseCasePage({ page }: { page: UseCase }) {
  const others = USE_CASES.filter((u) => u.href !== page.path);
  return (
    <>
      <SiteHeader links={SITE_LINKS} />
      <main id="main">
        <section className={`container ${styles.hero}`} aria-labelledby="page-title">
          <p className={styles.kicker}>{page.name}</p>
          <h1 id="page-title" className="t-display-xl">
            {page.headline[0]} <span className="hl">{page.headline[1]}</span>
          </h1>
          <p className={styles.lede}>{page.lede}</p>
          <div className={styles.action}>
            <LinkForm variant="hero" id="hero-link" />
            <Link href="/new?mode=upload" className={`btn btn-secondary btn-lg ${styles.upload}`}>
              <UploadSimple size={18} aria-hidden />
              Upload a file
            </Link>
          </div>
        </section>

        <div className={`container ${styles.visual}`}>{page.visual}</div>

        <section className={`container ${styles.section}`} aria-labelledby="steps-title">
          <h2 id="steps-title" className="t-display-lg">
            how it <span className="hl">works.</span>
          </h2>
          <ol className={styles.steps}>
            {page.steps.map((step, i) => (
              <li key={step.title} className={styles.step}>
                <span className={styles.number} aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="t-heading-md">{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={`container ${styles.section}`} aria-labelledby="details-title">
          <h2 id="details-title" className="t-display-lg">
            the <span className="hl">details.</span>
          </h2>
          <div className={styles.details}>
            {page.details.map((d) => (
              <article key={d.title} className={styles.detail}>
                <h3 className="t-heading-sm">{d.title}</h3>
                <p>{d.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={`container ${styles.section} ${styles.faq}`} aria-labelledby="faq-title">
          <h2 id="faq-title" className="t-display-lg">
            questions, <span className="hl">answered.</span>
          </h2>
          <FaqList items={page.faq} name="faq" />
        </section>

        <nav className={`container ${styles.section}`} aria-labelledby="more-title">
          <h2 id="more-title" className="t-heading-lg">
            More with Bamio
          </h2>
          <ul className={styles.more}>
            {[...others, { href: "/pricing", label: "Plans and pricing" }].map((u) => (
              <li key={u.href}>
                <Link href={u.href} className={styles.moreLink}>
                  {u.label}
                  <ArrowRight size={18} aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <section id="get-started" className={`container ${styles.section}`} aria-labelledby="cta-title">
          <div className={styles.cta}>
            <h2 id="cta-title" className="t-display-lg">
              paste a link, get the clips.
            </h2>
            <LinkForm variant="panel" />
          </div>
        </section>
      </main>
      <SiteFooter links={SITE_LINKS} credit={page.credit} />
      <JsonLd
        data={[
          ORGANIZATION,
          WEBSITE,
          softwareData(),
          { "@type": "WebPage", "@id": `${SITE_URL}${page.path}`, url: `${SITE_URL}${page.path}`, name: page.name, about: { "@id": `${SITE_URL}/#app` }, isPartOf: { "@id": `${SITE_URL}/#website` } },
          breadcrumbData({ name: page.name, path: page.path }),
          faqData(faqPlain(page.faq)),
        ]}
      />
    </>
  );
}
