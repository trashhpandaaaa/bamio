import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * /robots.txt: crawlers (search engines and AI assistants alike) may read the public pages; the
 * API, the pages behind sign-in (they'd only redirect to sign-in) and referral links (redirects) are left out. Sign-in and
 * sign-up stay crawlable so crawlers see their noindex.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/projects", "/new", "/profile", "/billing", "/r/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
