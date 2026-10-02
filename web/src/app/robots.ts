import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * /robots.txt: crawlers (search engines and AI assistants alike) may read the public pages; the
 * API and the pages behind sign-in are left out (they'd only redirect to sign-in). Sign-in and
 * sign-up stay crawlable so crawlers see their noindex.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/projects", "/new", "/profile", "/billing"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
