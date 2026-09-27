"use client";

import { Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthControls } from "@/components/auth-controls";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { useAiStatus } from "@/hooks/use-ai-status";
import styles from "./app-header.module.css";

export function AppHeader() {
  const pathname = usePathname();
  const { status } = useAiStatus();
  const needsKey = status && !status.configured;

  return (
    <header className={styles.bar}>
      <div className={styles.inner}>
        <Wordmark href="/projects" size={25} />
        <nav className={styles.nav} aria-label="Main">
          <Link href="/projects" aria-current={pathname === "/projects" ? "page" : undefined}>
            Videos
          </Link>
          <Link href="/new" aria-current={pathname === "/new" ? "page" : undefined}>
            New video
          </Link>
        </nav>
        <div className={styles.right}>
          {needsKey ? (
            <span className="badge is-warning" title="Add GEMINI_API_KEY to web/.env.local">
              <Warning size={14} aria-hidden />
              AI not connected
            </span>
          ) : null}
          {status?.mock ? <span className="badge is-info">Demo AI</span> : null}
          <ThemeToggle />
          <AuthControls />
        </div>
      </div>
    </header>
  );
}
