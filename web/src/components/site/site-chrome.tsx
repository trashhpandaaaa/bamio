import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { Wordmark } from "@/components/brand";
import { MobileMenu } from "@/components/landing/mobile-menu";
import { FooterAccountLinks, ProjectsLink, SignInLink } from "@/components/site/account-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/contact";
import { COMPANY, LEGAL_PAGES } from "@/lib/legal";
import { USE_CASES } from "@/lib/site";
import styles from "./site-chrome.module.css";

/** A link in the marketing pages' bar, menu or footer: "#how" on the same page, or a path. */
export type SiteLink = { href: string; label: string };

/** In-page anchors stay plain links (smooth scrolling); pages go through next/link. */
function SiteAnchor({ link, current }: { link: SiteLink; current?: string }) {
  if (link.href.startsWith("#")) return <a href={link.href}>{link.label}</a>;
  return (
    <Link href={link.href} aria-current={link.href === current ? "page" : undefined}>
      {link.label}
    </Link>
  );
}

/**
 * The marketing pages' top bar: the wordmark, their links (in a menu below 900px), and
 * sign-in or the account menu. `menu`: the menu's links, when they differ from the bar's.
 */
export function SiteHeader({ links, menu = links, current }: { links: SiteLink[]; menu?: SiteLink[]; current?: string }) {
  return (
    <header className={styles.top}>
      <div className={`container ${styles.topInner}`}>
        <Wordmark />
        <nav className={styles.topNav} aria-label="Main">
          {links.map((link) => (
            <SiteAnchor key={link.href} link={link} current={current} />
          ))}
          <ProjectsLink />
        </nav>
        <div className={styles.topAuth}>
          <AuthControls />
          <MobileMenu>
            {menu.map((link) => (
              <SiteAnchor key={link.href} link={link} current={current} />
            ))}
            <ProjectsLink />
            <SignInLink />
          </MobileMenu>
        </div>
      </div>
    </header>
  );
}

/**
 * The marketing pages' footer. `roomForBar`: leaves space on phones for the landing page's
 * sticky link bar. `credit`: a line for what the page shows (the landing page's stock footage).
 */
export function SiteFooter({ links, roomForBar = false, credit }: { links: SiteLink[]; roomForBar?: boolean; credit?: string }) {
  return (
    <footer className={`container ${styles.footer}`} data-bar={roomForBar ? "" : undefined}>
      <div className={styles.footerPanel}>
        <div className={styles.footerBrand}>
          <Wordmark size={30} />
          <p>Make the first second count.</p>
          <a className={styles.contact} href={SUPPORT_MAILTO}>
            {SUPPORT_EMAIL}
          </a>
        </div>
        <nav className={styles.footerNav} aria-label="Footer">
          <div>
            <p className={styles.footerTitle}>Product</p>
            <ul>
              {links.map((link) => (
                <li key={link.href}>
                  <SiteAnchor link={link} />
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className={styles.footerTitle}>Made for</p>
            <ul>
              {USE_CASES.map((page) => (
                <li key={page.href}>
                  <Link href={page.href}>{page.label}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className={styles.footerTitle}>Your account</p>
            <ul>
              <FooterAccountLinks />
            </ul>
          </div>
        </nav>
        <div className={styles.footerBottom}>
          <p>
            Only clip videos you own or have permission to use. Bamio transcribes videos itself; Google Gemini picks the clips.{credit ? ` ${credit}` : null}
          </p>
          {COMPANY.ready ? (
            <nav className={styles.legal} aria-label="Legal">
              {LEGAL_PAGES.map((p) => (
                <Link key={p.href} href={p.href}>
                  {p.label}
                </Link>
              ))}
            </nav>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
