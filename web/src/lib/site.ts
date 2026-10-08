import type { Metadata } from "next";
import { INTERVALS, PLAN_IDS, PLANS } from "@/lib/billing/plans";

/*
 * The public site, for search engines and link previews: its address, how pages describe
 * themselves (canonical link, Open Graph, X card), and the structured data (JSON-LD) that tells
 * search engines and AI assistants what Bamio is. Shared by app/layout.tsx, the marketing pages,
 * robots.ts and sitemap.ts.
 */

/** The canonical address: BAMIO_APP_URL when set, else the live site (also during builds). */
export const SITE_URL = (process.env.BAMIO_APP_URL || "https://bamio.app").trim().replace(/\/+$/, "");
export const SITE_NAME = "Bamio";

export const HOME_TITLE = "Bamio: AI clip maker for YouTube, Twitch and podcasts";
/** At most about 160 characters: search results cut longer descriptions. */
export const HOME_DESCRIPTION = "Turn long videos into vertical shorts. Paste a YouTube, Twitch or Kick link: Bamio finds the best moments and captions every word, in 100+ languages.";

export const PRICING_DESCRIPTION = "Bamio plans: Starter, Pro and Team. AI clip finding, captions in 100+ languages and 1080p exports with no watermark. Pay monthly, or every 3 months and save.";
export const CLIPPERS_TITLE = "Clipping campaigns: get paid per view for your clips";
export const CLIPPERS_DESCRIPTION = "Join a clipping campaign and earn for every 1,000 views on your clips. Podcasters, streamers and businesses: run one and pay clippers per view.";

/**
 * The marketing pages people search for, in the order the footer and sitemap list them, each
 * with the title and description search results show (a description of at most 160 characters:
 * longer ones are cut; a test checks). One page per search, so two pages never compete for the
 * same words.
 */
export const USE_CASES = [
  {
    href: "/ai-video-clipper",
    label: "AI video clipper",
    title: "AI video clipper: turn long videos into short clips",
    description: "An AI video clipper for long videos: paste a link or upload a file, and Bamio picks the best moments, scores them and exports captioned vertical clips.",
  },
  {
    href: "/youtube-to-shorts",
    label: "YouTube to Shorts",
    title: "YouTube to Shorts: turn long videos into Shorts with AI",
    description: "Paste a YouTube link and Bamio finds the moments that work as Shorts, frames them 9:16 and captions every word. Import just part of a long video. No watermark.",
  },
  {
    href: "/youtube-to-tiktok",
    label: "YouTube to TikTok",
    title: "YouTube to TikTok: turn YouTube videos into TikTok clips",
    description: "Turn a YouTube video into TikTok clips: Bamio picks the moments, crops them to 9:16 and captions every word. Download 1080p MP4s with no watermark.",
  },
  {
    href: "/video-to-reels",
    label: "Video to Reels",
    title: "Video to Reels: turn long videos into Instagram Reels",
    description: "Turn long videos into Instagram Reels: Bamio finds the best moments, frames them 9:16 and burns in word-by-word captions. 1080p MP4, no watermark.",
  },
  {
    href: "/podcast-clips",
    label: "Podcast clips",
    title: "Podcast clips: turn video podcast episodes into shorts with AI",
    description: "Turn video podcast episodes into vertical clips: Bamio finds the best moments, keeps the speaker in frame and captions every word, in 100+ languages.",
  },
  {
    href: "/twitch-clips",
    label: "Twitch clips",
    title: "Twitch clip maker: clip Twitch streams and VODs, even live",
    description: "Paste a Twitch link and Bamio turns the stream or VOD into vertical clips with word-by-word captions. Follow a live stream and clip while it's still on.",
  },
  {
    href: "/kick-clips",
    label: "Kick clips",
    title: "Kick clip maker: turn Kick streams into vertical clips",
    description: "Paste a Kick link and Bamio turns the stream or past broadcast into vertical clips with word-by-word captions, ready for TikTok, Shorts and Reels.",
  },
  {
    href: "/gaming-clips",
    label: "Gaming clips",
    title: "Gaming clips: turn streams and gameplay into shorts with AI",
    description: "Turn gaming streams and gameplay videos into vertical clips. Bamio finds highlights from the commentary and the loudest moments, then captions every word.",
  },
  {
    href: "/auto-captions",
    label: "Auto captions",
    title: "Auto captions for short videos, word by word, in 100+ languages",
    description: "Word-by-word captions for TikTok, Shorts and Reels, timed from the audio and burned into a 1080p MP4. In 100+ languages, with the right font for every script.",
  },
] as const;

export type UseCasePath = (typeof USE_CASES)[number]["href"];

/** A use-case page's metadata, from the list above. */
export function metadataForUseCase(path: UseCasePath): Metadata {
  const page = USE_CASES.find((u) => u.href === path)!;
  return pageMetadata({ title: page.title, description: page.description, path, absoluteTitle: true });
}

/**
 * A public page's metadata: title, description, its canonical address, and the same for link
 * previews (Next.js replaces the root layout's openGraph rather than merging it, so each page
 * sets the whole object; the preview image comes from the nearest opengraph-image file).
 */
export function pageMetadata(page: { title: string; description: string; path: string; absoluteTitle?: boolean }): Metadata {
  return {
    title: page.absoluteTitle ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: page.path, title: page.title, description: page.description },
    twitter: { card: "summary_large_image", title: page.title, description: page.description },
  };
}

/** For pages behind sign-in, or with nothing for a search result (sign-in, the editor): never indexed. */
export const PRIVATE_PAGE: Metadata["robots"] = { index: false, follow: false };

/* ------------------------------ Structured data ------------------------------ */

export const ORGANIZATION = {
  "@type": "Organization",
  "@id": `${SITE_URL}/#organization`,
  name: SITE_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon-512.png`,
  slogan: "Make the first second count.",
};

export const WEBSITE = {
  "@type": "WebSite",
  "@id": `${SITE_URL}/#website`,
  name: SITE_NAME,
  url: SITE_URL,
  publisher: { "@id": `${SITE_URL}/#organization` },
  inLanguage: "en",
};

/** Bamio as a web app, with each plan's prices from the catalog (no ratings: there are none to show). */
export function softwareData() {
  return {
    "@type": "SoftwareApplication",
    "@id": `${SITE_URL}/#app`,
    name: SITE_NAME,
    url: SITE_URL,
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "Video editing",
    operatingSystem: "Web browser",
    description: HOME_DESCRIPTION,
    publisher: { "@id": `${SITE_URL}/#organization` },
    featureList: [
      "AI clip finding with a score, title and reason for every clip",
      "Import from YouTube, Twitch, Kick and 1,000+ sites, or upload a file",
      "Follow live streams and clip while they're live",
      "Word-by-word captions in 100+ languages, detected automatically",
      "Reframe to 9:16, 1:1 or 16:9",
      "1080p MP4 export with no watermark",
    ],
    offers: PLAN_IDS.flatMap((id) =>
      INTERVALS.map((interval) => ({
        "@type": "Offer",
        name: `${PLANS[id].name}, ${interval === "month" ? "monthly" : "every 3 months"}`,
        url: `${SITE_URL}/pricing`,
        priceCurrency: "USD",
        price: (PLANS[id].price[interval] / 100).toFixed(2),
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: (PLANS[id].price[interval] / 100).toFixed(2),
          priceCurrency: "USD",
          billingDuration: interval === "month" ? "P1M" : "P3M",
        },
        description: `${PLANS[id].minutes.toLocaleString("en-US")} AI processing minutes a month`,
      })),
    ),
  };
}

/** Questions and answers as structured data (answers as plain text). */
export function faqData(items: { q: string; text: string }[]) {
  return {
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({ "@type": "Question", name: i.q, acceptedAnswer: { "@type": "Answer", text: i.text } })),
  };
}

/** Home → (the page it belongs under →) this page, for search results that show the path. */
export function breadcrumbData(page: { name: string; path: string }, parent?: { name: string; path: string }) {
  const trail = [{ name: SITE_NAME, path: "" }, ...(parent ? [parent] : []), page];
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, i) => ({ "@type": "ListItem", position: i + 1, name: step.name, item: `${SITE_URL}${step.path}` })),
  };
}
