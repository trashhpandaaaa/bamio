import type { Icon } from "@phosphor-icons/react";
import { Broadcast, InstagramLogo, TiktokLogo, TwitchLogo, XLogo, YoutubeLogo } from "@phosphor-icons/react/ssr";
import { formatPrice } from "@/lib/billing/plans";
import { CLIP_PLATFORMS, type ChannelPlatform, type ClipPlatform } from "@/lib/campaigns/links";
import type { CampaignStatus } from "@/lib/campaigns/schema";
import styles from "./campaigns.module.css";

/* The pieces every campaign view shares: the public pages, the clipper's panel and the admin panel. */

export const PLATFORM_ICONS: Record<ChannelPlatform, Icon> = { youtube: YoutubeLogo, twitch: TwitchLogo, kick: Broadcast, tiktok: TiktokLogo, instagram: InstagramLogo, x: XLogo };

/** "$2 per 1,000 views". */
export const rateLabel = (cents: number) => `${formatPrice(cents)} per 1,000 views`;

/** "Oct 31, 2026" (UTC, the same for everyone). */
export const dayLabel = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Where a campaign's clips may be posted: the sites' marks, with their names for screen readers and on hover. */
export function Platforms({ list, size = 18 }: { list: ClipPlatform[]; size?: number }) {
  return (
    <span className={styles.platforms}>
      <span className="sr-only">Post on {list.map((p) => CLIP_PLATFORMS[p].name).join(", ")}</span>
      {list.map((p) => {
        const PlatformIcon = PLATFORM_ICONS[p];
        return (
          <span key={p} title={CLIP_PLATFORMS[p].name} aria-hidden="true">
            <PlatformIcon size={size} weight="fill" />
          </span>
        );
      })}
    </span>
  );
}

const STATUS: Record<CampaignStatus, [tone: string, label: string]> = {
  draft: ["is-info", "Draft"],
  live: ["is-live", "Open"],
  paused: ["is-warning", "Paused"],
  ended: ["", "Ended"],
};

export function StatusBadge({ status }: { status: CampaignStatus }) {
  const [tone, label] = STATUS[status];
  return <span className={`badge ${tone}`}>{label}</span>;
}

/** How much of a campaign's budget is used: the amounts, and a bar. */
export function Budget({ spentCents, budgetCents }: { spentCents: number; budgetCents: number }) {
  const share = budgetCents > 0 ? Math.min(1, spentCents / budgetCents) : 0;
  return (
    <div className={styles.budget}>
      <p className={styles.budgetText}>
        <b>{formatPrice(Math.min(spentCents, budgetCents))}</b> of {formatPrice(budgetCents)} used
      </p>
      <div className="progress" aria-hidden="true" style={{ "--value": `${(share * 100).toFixed(1)}%` } as React.CSSProperties}>
        <span />
      </div>
    </div>
  );
}
