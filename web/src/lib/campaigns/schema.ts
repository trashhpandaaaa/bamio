import { z } from "zod";
import { channelLink, CLIP_PLATFORM_IDS, LINK_MAX, type ChannelLink, type ClipPlatform } from "@/lib/campaigns/links";

/*
 * Clipping campaigns (/clippers): what a campaign is, what clippers and admins may send, and
 * what the pages show. Shared by the forms, the API and the pages; the database side is
 * src/lib/server/campaigns.ts, the money in money.ts.
 */

export const CAMPAIGN_LIMITS = {
  nameMin: 2,
  name: 40,
  /** How a clipper wants to be paid. */
  payout: 200,
  title: 80,
  brand: 60,
  summary: 160,
  brief: 2000,
  rules: 1500,
  /** How the owner pays, on the campaign's page. */
  payoutTerms: 300,
  /** Why a clip was rejected; a note on a payment. */
  note: 200,
  /** Clips one clipper may have in one campaign, and how many of them may wait for a look at once. */
  clips: 60,
  waiting: 10,
  /** $100 per 1,000 views, a $1,000,000 budget, 2 billion views: far past any real campaign, and the cents still fit the database's 32-bit columns. */
  rateCents: 10_000,
  budgetCents: 100_000_000,
  views: 2_000_000_000,
} as const;

export const CAMPAIGN_STATUSES = ["draft", "live", "paused", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export type ClipStatus = "pending" | "approved" | "rejected";

/** Control characters, zero-width marks and Unicode line and space separators (by code point, so nothing invisible lives in this file). */
const odd = (code: number) => code <= 0x1f || code === 0x7f || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202f);
const clean = (s: string, keepLines: boolean) => Array.from(s, (c) => (odd(c.codePointAt(0) ?? 0) && !(keepLines && c === "\n") ? " " : c)).join("");

/** One line, with odd whitespace and control characters taken out. */
const tidy = (s: string) => clean(s, false).replace(/\s+/g, " ").trim();
/** Several lines: each tidied, empty ones dropped. */
const tidyLines = (s: string) =>
  clean(s.replace(/\r\n?/g, "\n"), true)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

const line = (max: number, min = 0, what = "This") =>
  z
    .string()
    .max(max * 4)
    .transform(tidy)
    .pipe(z.string().min(min, `${what} is too short.`).max(max, `Keep it to ${max} characters.`));
const lines = (max: number, min = 0, what = "This") =>
  z
    .string()
    .max(max * 4)
    .transform(tidyLines)
    .pipe(z.string().min(min, `${what} is too short.`).max(max, `Keep it to ${max} characters.`));

/* ------------------------------ Clippers ------------------------------ */

/** Who a clipper is in campaigns: a public name, the channel they post on, and (for admins only) how to pay them. */
export const clipperInputSchema = z.object({
  name: z
    .string()
    .max(200)
    .transform(tidy)
    .pipe(z.string().min(CAMPAIGN_LIMITS.nameMin, "Add a name of at least 2 characters.").max(CAMPAIGN_LIMITS.name, `Keep the name to ${CAMPAIGN_LIMITS.name} characters.`)),
  link: z
    .string()
    .max(LINK_MAX)
    .transform((s) => s.trim())
    .refine((s) => channelLink(s) !== null, "Use a link to your channel on TikTok, YouTube, Instagram, X, Twitch or Kick."),
  payout: z.string().max(1000).transform(tidy).pipe(z.string().max(CAMPAIGN_LIMITS.payout, `Keep it to ${CAMPAIGN_LIMITS.payout} characters.`)),
});
export type ClipperInput = z.infer<typeof clipperInputSchema>;

/** A user's own clipper details, as their profile and the campaign pages show them. */
export type MyClipper = { name: string; link: string; payout: string; imageUrl: string | null; blocked: boolean };

/* ------------------------------ Campaigns ------------------------------ */

const cents = (max: number, what: string) => z.number().int(`${what}: whole cents.`).min(1, `${what} must be more than nothing.`).max(max, `${what} is too large.`);

/** What an admin fills in. Money in cents; `sourceUrl` empty for none; `endsAt` a time or null. */
export const campaignInputSchema = z.object({
  title: line(CAMPAIGN_LIMITS.title, 4, "The title"),
  brand: line(CAMPAIGN_LIMITS.brand, 2, "Whose campaign it is"),
  summary: line(CAMPAIGN_LIMITS.summary, 10, "The summary"),
  brief: lines(CAMPAIGN_LIMITS.brief, 20, "What to clip"),
  rules: lines(CAMPAIGN_LIMITS.rules),
  sourceUrl: z
    .string()
    .max(LINK_MAX)
    .transform((s) => s.trim())
    .refine((s) => s === "" || sourceLink(s) !== null, "Use a full https link, or leave it empty."),
  platforms: z
    .array(z.enum(CLIP_PLATFORM_IDS as [ClipPlatform, ...ClipPlatform[]]))
    .min(1, "Choose at least one place clips may be posted.")
    .transform((list) => CLIP_PLATFORM_IDS.filter((p) => list.includes(p))),
  rateCents: cents(CAMPAIGN_LIMITS.rateCents, "The rate"),
  budgetCents: cents(CAMPAIGN_LIMITS.budgetCents, "The budget"),
  minViews: z.number().int().min(0).max(CAMPAIGN_LIMITS.views),
  maxClipCents: cents(CAMPAIGN_LIMITS.budgetCents, "The most a clip can earn").nullable(),
  payout: lines(CAMPAIGN_LIMITS.payoutTerms),
  endsAt: z.number().int().positive().nullable(),
});
export type CampaignInput = z.infer<typeof campaignInputSchema>;

/** The content to clip: a plain https link (it's shown on the page and handed to the importer). */
export function sourceLink(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return url.protocol === "https:" && !url.username && !url.password && url.hostname.includes(".") ? url.href : null;
  } catch {
    return null;
  }
}

/** A campaign's address from its title: "Ninja: Fortnite clips!" becomes "ninja-fortnite-clips". */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return slug.length >= 3 ? slug : "campaign";
}

/** "2.50", "$1,000" or "40" as cents. Null when it isn't an amount of money. */
export function parseDollars(input: string): number | null {
  const text = input.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export type Campaign = {
  id: string;
  slug: string;
  title: string;
  brand: string;
  summary: string;
  brief: string;
  rules: string[];
  sourceUrl: string | null;
  platforms: ClipPlatform[];
  rateCents: number;
  budgetCents: number;
  minViews: number;
  maxClipCents: number | null;
  payout: string;
  status: CampaignStatus;
  endsAt: number | null;
  createdAt: number;
};

/** How a campaign is doing: budget spent (cents), and the clippers, clips and views that count. */
export type CampaignStats = { spentCents: number; clippers: number; clips: number; views: number };
export type CampaignCard = Campaign & { stats: CampaignStats };

/** A row of a campaign's leaderboard. */
export type Leader = { name: string; imageUrl: string | null; link: ChannelLink | null; clips: number; views: number; earnedCents: number };

/** A clip its clipper sent, as they see it. `views` null: not counted yet. */
export type MyClip = {
  id: number;
  url: string;
  platform: ClipPlatform;
  status: ClipStatus;
  note: string | null;
  views: number | null;
  /** Bamio couldn't read the views from the site: an admin adds them. */
  byHand: boolean;
  earnedCents: number;
  createdAt: number;
};

/** A signed-in user's place in one campaign. */
export type MyCampaign = { clipper: MyClipper | null; joined: boolean; clips: MyClip[]; earnedCents: number; paidCents: number; owedCents: number };

/** A campaign the user joined, for their list. */
export type JoinedCampaign = { slug: string; title: string; brand: string; status: CampaignStatus; clips: number; waiting: number; earnedCents: number; owedCents: number };

/** May a clipper join it or send clips now? */
export const isOpen = (c: { status: CampaignStatus }) => c.status === "live";
