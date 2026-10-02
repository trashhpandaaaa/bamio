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

/** The marketing pages people search for, in the order the footer and sitemap list them. */
export const USE_CASES = [
  { href: "/youtube-to-shorts", label: "YouTube to Shorts" },
  { href: "/podcast-clips", label: "Podcast clips" },
  { href: "/twitch-clips", label: "Twitch and Kick clips" },
  { href: "/auto-captions", label: "Auto captions" },
] as const;

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

/** Home → this page, for search results that show the path. */
export function breadcrumbData(page: { name: string; path: string }) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: SITE_NAME, item: SITE_URL },
      { "@type": "ListItem", position: 2, name: page.name, item: `${SITE_URL}${page.path}` },
    ],
  };
}
