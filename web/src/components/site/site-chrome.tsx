import { Show } from "@clerk/nextjs";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { Wordmark } from "@/components/brand";
import { MobileMenu } from "@/components/landing/mobile-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { billingEnabled } from "@/lib/server/billing";
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
          <Show when="signed-in">
            <Link href="/projects">Your projects</Link>
          </Show>
        </nav>
        <div className={styles.topAuth}>
          <AuthControls />
          <MobileMenu>
            {menu.map((link) => (
              <SiteAnchor key={link.href} link={link} current={current} />
            ))}
            <Show when="signed-in">
              <Link href="/projects">Your projects</Link>
            </Show>
            <Show when="signed-out">
              <Link href="/sign-in">Sign in</Link>
            </Show>
          </MobileMenu>
        </div>
      </div>
    </header>
  );
}

/** The marketing pages' footer. `roomForBar`: leaves space on phones for the landing page's sticky link bar. */
export function SiteFooter({ links, roomForBar = false }: { links: SiteLink[]; roomForBar?: boolean }) {
  return (
    <footer className={`container ${styles.footer}`} data-bar={roomForBar ? "" : undefined}>
      <div className={styles.footerPanel}>
        <div className={styles.footerBrand}>
          <Wordmark size={30} />
          <p>Make the first second count.</p>
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
            <p className={styles.footerTitle}>Your account</p>
            <ul>
              <Show when="signed-out">
                <li>
                  <Link href="/sign-in">Sign in</Link>
                </li>
                <li>
                  <Link href="/sign-up">Sign up</Link>
                </li>
              </Show>
              <Show when="signed-in">
                <li>
                  <Link href="/projects">Your projects</Link>
                </li>
                <li>
                  <Link href="/new">Import a video</Link>
                </li>
                <li>
                  <Link href="/profile/clip-defaults">Clip defaults</Link>
                </li>
                {billingEnabled() ? (
                  <li>
                    <Link href="/billing">Plan &amp; billing</Link>
                  </li>
                ) : null}
              </Show>
            </ul>
          </div>
        </nav>
        <div className={styles.footerBottom}>
          <p>Only clip videos you own or have permission to use. Bamio transcribes videos itself; Google Gemini picks the clips.</p>
          <ThemeToggle />
        </div>
      </div>
    </footer>
  );
}
