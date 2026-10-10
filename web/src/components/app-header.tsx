"use client";

import { Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { AuthControls } from "@/components/auth-controls";
import { Wordmark } from "@/components/brand";
import { ThemeCycleButton, ThemeToggle } from "@/components/theme-toggle";
import { useSystemStatus } from "@/hooks/use-project";
import styles from "./app-header.module.css";

export function AppHeader() {
  const pathname = usePathname();
  const status = useSystemStatus();
  const onProjects = pathname === "/projects" || pathname.startsWith("/projects/");
  const nav = useRef<HTMLElement>(null);
  // On a phone the menu scrolls sideways: bring the page you're on into view.
  useEffect(() => {
    const menu = nav.current;
    const here = menu?.querySelector<HTMLElement>("a[aria-current=page]");
    if (menu && here) menu.scrollLeft += here.getBoundingClientRect().left - menu.getBoundingClientRect().left - 8;
  }, [pathname]);

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Wordmark href="/projects" size={25} />
        <nav ref={nav} className={styles.nav} aria-label="Main">
          <Link href="/projects" aria-current={onProjects ? "page" : undefined}>
            Projects
          </Link>
          <Link href="/new" aria-current={pathname === "/new" ? "page" : undefined} data-optional="">
            Import
          </Link>
          <Link href="/editor" aria-current={pathname === "/editor" ? "page" : undefined}>
            Editor
          </Link>
          {/* "Downloader", not "Download": a clip's page has its own Download link, for the exported clip. */}
          <Link href="/download" aria-current={pathname === "/download" ? "page" : undefined}>
            Downloader
          </Link>
        </nav>
        <div className={styles.right}>
          {status && !status.ai.configured ? (
            <span className="badge is-warning" title="Add GEMINI_API_KEY to web/.env, then restart the server">
              <Warning size={14} aria-hidden />
              AI off
            </span>
          ) : null}
          {status && !status.ytdlp ? (
            <span className="badge is-warning" title="Run npm run setup:media in web/, then restart the server">
              <Warning size={14} aria-hidden />
              Link import off
            </span>
          ) : null}
          {status?.ai.mock ? <span className="badge is-info">Demo AI</span> : null}
          <span className={styles.themeFull}>
            <ThemeToggle />
          </span>
          <ThemeCycleButton className={styles.themeCompact} />
          <AuthControls />
        </div>
      </div>
    </header>
  );
}
