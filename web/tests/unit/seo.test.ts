import { readdirSync, existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { PLANS } from "@/lib/billing/plans";
import { CAPTION_LANGUAGES, captionLanguageMeta, punctuated } from "@/lib/caption-languages";
import { ADSENSE_CLIENT, ADSENSE_SCRIPT } from "@/lib/ads";
import { CONTACT_EMAIL, CONTACT_MAILTO, SUPPORT_EMAIL, SUPPORT_MAILTO } from "@/lib/contact";
import { COMPANY, LEGAL_PAGES } from "@/lib/legal";
import { fontRuns } from "@/lib/server/caption-fonts";
import { breadcrumbData, CLIPPERS_DESCRIPTION, CLIPPERS_TITLE, faqData, HOME_DESCRIPTION, HOME_TITLE, ORGANIZATION, pageMetadata, PRICING_DESCRIPTION, SITE_URL, softwareData, USE_CASES } from "@/lib/site";

describe("search engines", () => {
  it("get every public page in the sitemap, and every page there exists", () => {
    const urls = sitemap().map((e) => e.url);
    const legal = COMPANY.ready ? LEGAL_PAGES.map((p) => `${SITE_URL}${p.href}`) : [];
    const languages = CAPTION_LANGUAGES.map((l) => `${SITE_URL}/auto-captions/${l.slug}`);
    expect(urls).toEqual([SITE_URL, `${SITE_URL}/pricing`, ...USE_CASES.map((u) => `${SITE_URL}${u.href}`), ...languages, `${SITE_URL}/clippers`, ...legal]);
    expect(new Set(urls).size).toBe(urls.length);
    for (const u of USE_CASES) expect(existsSync(`src/app${u.href}/page.tsx`), u.href).toBe(true);
    // A new public page needs a place here (and a share image).
    const routes = readdirSync("src/app", { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(`src/app/${d.name}/page.tsx`) && !d.name.startsWith("["))
      .map((d) => `/${d.name}`);
    const privateRoutes = ["/admin", "/billing", "/download", "/editor", "/new", "/projects", "/profile", "/sign-in", "/sign-up"];
    expect(routes.filter((r) => !privateRoutes.includes(r)).sort()).toEqual(["/pricing", "/clippers", ...USE_CASES.map((u) => u.href), ...LEGAL_PAGES.map((p) => p.href)].sort());
    for (const u of [...USE_CASES, { href: "/clippers" }, { href: "/auto-captions/[language]" }]) expect(existsSync(`src/app${u.href}/opengraph-image.tsx`), u.href).toBe(true);
  });

  it("see a title that fits and a description of 160 characters or fewer on every page, no two alike", () => {
    const pages = [
      { title: HOME_TITLE, description: HOME_DESCRIPTION },
      { title: "Pricing", description: PRICING_DESCRIPTION },
      { title: CLIPPERS_TITLE, description: CLIPPERS_DESCRIPTION },
      ...USE_CASES,
      ...CAPTION_LANGUAGES.map(captionLanguageMeta),
    ];
    for (const page of pages) {
      expect(page.description.length, page.title).toBeLessThanOrEqual(160);
      expect(page.description.length, page.title).toBeGreaterThanOrEqual(110);
      expect(page.title.length, page.title).toBeLessThanOrEqual(65);
      // Bamio's voice: no em dashes.
      expect(page.title + page.description).not.toMatch(/—/);
    }
    expect(new Set(pages.map((p) => p.title)).size).toBe(pages.length);
    expect(new Set(pages.map((p) => p.description)).size).toBe(pages.length);
  });

  it("find a captions page for each language, true to how Bamio writes it", () => {
    expect(new Set(CAPTION_LANGUAGES.map((l) => l.slug)).size).toBe(CAPTION_LANGUAGES.length);
    expect(new Set(CAPTION_LANGUAGES.map((l) => l.code)).size).toBe(CAPTION_LANGUAGES.length);
    for (const l of CAPTION_LANGUAGES) {
      expect(l.slug, l.name).toMatch(/^[a-z]+$/);
      expect(l.own.text.length, l.name).toBeGreaterThan(40);
      // The font the page names is the one the sample is drawn in ("NotoSansDevanagari" is Noto Sans Devanagari).
      const drawn = fontRuns(l.sample.join(" "), l.code).filter((r) => /\p{L}/u.test(r.text));
      const names = new Set(drawn.map((r) => (r.font?.id === "Bricolage" ? "Bricolage Grotesque" : (r.font?.id ?? "").replace(/([a-z])([A-Z])/g, "$1 $2"))));
      expect([...names], l.name).toEqual([l.font]);
      // Languages the European model writes come with punctuation, and their samples show it; the others don't.
      expect(/[.?!]$/.test(l.sample.at(-1)!), l.name).toBe(punctuated(l));
      if (!punctuated(l) && l.script.startsWith("Latin")) expect(l.sample.join(" "), l.name).toBe(l.sample.join(" ").toLowerCase());
    }
    expect(breadcrumbData({ name: "Hindi captions", path: "/auto-captions/hindi" }, { name: "Auto captions", path: "/auto-captions" }).itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Bamio", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Auto captions", item: `${SITE_URL}/auto-captions` },
      { "@type": "ListItem", position: 3, name: "Hindi captions", item: `${SITE_URL}/auto-captions/hindi` },
    ]);
  });

  it("are kept out of the API and the pages behind sign-in, and told where the sitemap is", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0]! : r.rules;
    expect(rules.allow).toBe("/");
    expect(rules.disallow).toEqual(expect.arrayContaining(["/api/", "/projects", "/new", "/editor", "/download", "/profile", "/billing"]));
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

  it("find the ads' publisher in ads.txt, the same one the script names", () => {
    expect(ADSENSE_CLIENT).toMatch(/^ca-pub-[0-9]{16}$/);
    expect(ADSENSE_SCRIPT).toBe(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`);
    // ads.txt: who may sell this site's ad space. Google's line, with the publisher id without its "ca-".
    expect(readFileSync("public/ads.txt", "utf8").trim()).toBe(`google.com, ${ADSENSE_CLIENT.replace("ca-", "")}, DIRECT, f08c47fec0942fa0`);
  });

  it("get structured data with the real prices, and plain-text answers", () => {
    const app = softwareData();
    expect(app.offers).toHaveLength(6);
    expect(app.offers[0]).toMatchObject({ price: (PLANS.starter.price.month / 100).toFixed(2), priceCurrency: "USD" });
    expect(app).not.toHaveProperty("aggregateRating");
    // The contact address, the same everywhere it's given.
    expect(CONTACT_EMAIL).toMatch(/^[a-z0-9.]+@bamio[.]app$/);
    expect(CONTACT_MAILTO).toBe(`mailto:${CONTACT_EMAIL}`);
    // The footer's address, for help.
    expect(SUPPORT_EMAIL).toBe("support@bamio.app");
    expect(SUPPORT_MAILTO).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(ORGANIZATION).toMatchObject({ email: CONTACT_EMAIL, contactPoint: { "@type": "ContactPoint", email: CONTACT_EMAIL } });
    expect(COMPANY.email).toBe(CONTACT_EMAIL);
    const faq = faqData([{ q: "Q?", text: "A." }]);
    expect(faq.mainEntity[0]).toEqual({ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } });
  });
});
