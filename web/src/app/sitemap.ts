import type { MetadataRoute } from "next";
import { COMPANY, LEGAL_PAGES } from "@/lib/legal";
import { SITE_URL, USE_CASES } from "@/lib/site";

/** /sitemap.xml: every public page (search engines find the rest by following links). The legal pages once they name the company. */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    ...USE_CASES.map((page) => ({ url: `${SITE_URL}${page.href}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.8 })),
    ...(COMPANY.ready ? LEGAL_PAGES.map((page) => ({ url: `${SITE_URL}${page.href}`, lastModified: now, changeFrequency: "yearly" as const, priority: 0.2 })) : []),
  ];
}
