import type { MetadataRoute } from "next";
import { SITE_URL, USE_CASES } from "@/lib/site";

/** /sitemap.xml: every public page (search engines find the rest by following links). */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    ...USE_CASES.map((page) => ({ url: `${SITE_URL}${page.href}`, lastModified: now, changeFrequency: "monthly" as const, priority: 0.8 })),
  ];
}
