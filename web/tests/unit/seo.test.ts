import { readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { PLANS } from "@/lib/billing/plans";
import { COMPANY, LEGAL_PAGES } from "@/lib/legal";
import { faqData, HOME_DESCRIPTION, pageMetadata, SITE_URL, softwareData, USE_CASES } from "@/lib/site";

describe("search engines", () => {
  it("get every public page in the sitemap, and every page there exists", () => {
    const urls = sitemap().map((e) => e.url);
    const legal = COMPANY.ready ? LEGAL_PAGES.map((p) => `${SITE_URL}${p.href}`) : [];
    expect(urls).toEqual([SITE_URL, `${SITE_URL}/pricing`, ...USE_CASES.map((u) => `${SITE_URL}${u.href}`), ...legal]);
    for (const u of USE_CASES) expect(existsSync(`src/app${u.href}/page.tsx`), u.href).toBe(true);
    // A new public page needs a place here (and a share image).
    const routes = readdirSync("src/app", { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(`src/app/${d.name}/page.tsx`) && !d.name.startsWith("["))
      .map((d) => `/${d.name}`);
    const privateRoutes = ["/admin", "/billing", "/new", "/projects", "/profile", "/sign-in", "/sign-up"];
    expect(routes.filter((r) => !privateRoutes.includes(r)).sort()).toEqual(["/pricing", ...USE_CASES.map((u) => u.href), ...LEGAL_PAGES.map((p) => p.href)].sort());
    for (const u of USE_CASES) expect(existsSync(`src/app${u.href}/opengraph-image.tsx`), u.href).toBe(true);
  });

  it("are kept out of the API and the pages behind sign-in, and told where the sitemap is", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    expect(rules.allow).toBe("/");
    expect(rules.disallow).toEqual(expect.arrayContaining(["/api/", "/projects", "/new", "/profile", "/billing"]));
    expect(rules.disallow).not.toContain("/pricing");
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });

  it("see a canonical address, a short description and a preview on each public page", () => {
    expect(HOME_DESCRIPTION.length).toBeLessThanOrEqual(160);
    const m = pageMetadata({ title: "T", description: "D", path: "/podcast-clips" });
    expect(m.alternates?.canonical).toBe("/podcast-clips");
    expect(m.openGraph).toMatchObject({ url: "/podcast-clips", title: "T", description: "D", siteName: "Bamio" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("get structured data with the real prices, and plain-text answers", () => {
    const app = softwareData();
    expect(app.offers).toHaveLength(6);
    expect(app.offers[0]).toMatchObject({ price: (PLANS.starter.price.month / 100).toFixed(2), priceCurrency: "USD" });
    expect(app).not.toHaveProperty("aggregateRating");
    const faq = faqData([{ q: "Q?", text: "A." }]);
    expect(faq.mainEntity[0]).toEqual({ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } });
  });
});
