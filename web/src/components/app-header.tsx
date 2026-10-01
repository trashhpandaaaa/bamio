"use client";

import { Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthControls } from "@/components/auth-controls";
import { Wordmark } from "@/components/brand";
import { ThemeCycleButton, ThemeToggle } from "@/components/theme-toggle";
import { useSystemStatus } from "@/hooks/use-project";
import styles from "./app-header.module.css";

export function AppHeader() {
  const pathname = usePathname();
  const status = useSystemStatus();
  const onProjects = pathname === "/projects" || pathname.startsWith("/projects/");

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Wordmark href="/projects" size={25} />
        <nav className={styles.nav} aria-label="Main">
          <Link href="/projects" aria-current={onProjects ? "page" : undefined}>
            Projects
          </Link>
          <Link href="/new" aria-current={pathname === "/new" ? "page" : undefined}>
            Import
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
