"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useEffect, useState } from "react";
import { StatusBadge } from "@/components/campaigns/parts";
import { formatPrice } from "@/lib/billing/plans";
import { api } from "@/lib/clips/api";
import type { JoinedCampaign } from "@/lib/campaigns/schema";
import styles from "./clippers.module.css";

/** The campaigns a signed-in clipper joined, with what each has earned them. Nothing for everyone else. */
export function YourCampaigns() {
  const { isSignedIn } = useAuth();
  const [list, setList] = useState<JoinedCampaign[] | null>(null);

  useEffect(() => {
    if (!isSignedIn) return;
    const controller = new AbortController();
    // If this fails the page is still whole: the campaigns are listed below.
    api.campaigns.mine(controller.signal).then(setList, () => undefined);
    return () => controller.abort();
  }, [isSignedIn]);

  if (!isSignedIn || !list || list.length === 0) return null;
  return (
    <section className={`container ${styles.section}`} aria-labelledby="yours-title">
      <h2 id="yours-title" className="t-heading-xl">
        Your campaigns
      </h2>
      <ul className={styles.yours}>
        {list.map((c) => (
          <li key={c.slug}>
            <Link href={`/clippers/${c.slug}`} className={styles.yourRow}>
              <span className={styles.yourName}>
                <b>{c.title}</b>
                <span>{c.brand}</span>
              </span>
              <StatusBadge status={c.status} />
              <span className={styles.yourNumbers}>
                {c.clips === 0 ? "No clips sent yet" : `${c.clips} ${c.clips === 1 ? "clip" : "clips"}`}
                {c.waiting > 0 ? ` · ${c.waiting} waiting for a look` : ""}
              </span>
              <span className={styles.yourMoney}>
                <b>{formatPrice(c.earnedCents)}</b> earned{c.owedCents > 0 ? ` · ${formatPrice(c.owedCents)} to come` : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
