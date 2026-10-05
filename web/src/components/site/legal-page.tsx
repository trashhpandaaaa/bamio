import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader, type SiteLink } from "@/components/site/site-chrome";
import { COMPANY, LEGAL_PAGES, LEGAL_UPDATED } from "@/lib/legal";
import { pageMetadata, PRIVATE_PAGE } from "@/lib/site";
import styles from "./legal-page.module.css";

const LINKS: SiteLink[] = [
  { href: "/#how", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
];

/** A legal page's metadata: not indexed while the company's details are placeholders. */
export function legalMetadata(page: { title: string; description: string; path: string }): Metadata {
  return { ...pageMetadata(page), ...(COMPANY.ready ? {} : { robots: PRIVATE_PAGE }) };
}

/** The Terms, the Privacy Policy and the Takedown page: one readable column of text. */
export function LegalPage({ title, lede, path, children }: { title: string; lede: string; path: string; children: ReactNode }) {
  return (
    <>
      <SiteHeader links={LINKS} />
      <main id="main" className={`container ${styles.page}`}>
        <article className={styles.article} aria-labelledby="legal-title">
          <header className={styles.head}>
            <p className={styles.kicker}>Legal</p>
            <h1 id="legal-title" className="t-display-lg">
              {title}
            </h1>
            <p className={styles.lede}>{lede}</p>
            <p className={styles.updated}>Last updated {LEGAL_UPDATED}</p>
            {COMPANY.ready ? null : (
              <p className={styles.draft} role="note">
                Draft: the company’s details are placeholders, and this page isn’t linked or shown to search engines yet.
              </p>
            )}
          </header>
          <div className={styles.body}>{children}</div>
          <nav className={styles.others} aria-label="Legal pages">
            {LEGAL_PAGES.filter((p) => p.href !== path).map((p) => (
              <Link key={p.href} href={p.href}>
                {p.label}
              </Link>
            ))}
          </nav>
        </article>
      </main>
      <SiteFooter links={LINKS} />
    </>
  );
}

/** The contact address, as a link. */
export function ContactEmail() {
  return <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>;
}
