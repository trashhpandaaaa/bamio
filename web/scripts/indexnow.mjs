#!/usr/bin/env node
/*
 * Tells search engines that support IndexNow (Bing, which also serves DuckDuckGo, Yahoo, Ecosia
 * and ChatGPT search; Yandex; Naver; Seznam) that the site's pages changed, so they crawl them
 * now instead of eventually. Reads the live sitemap and submits every URL in it. The key is
 * public by design: search engines check it at https://<site>/<key>.txt (web/public/).
 * Run after a deploy that changes public pages:
 *   npm run seo:indexnow                (https://bamio.app, or BAMIO_APP_URL)
 * Google doesn't use IndexNow: it reads the sitemap (submit it once in Search Console).
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const KEY = "85a95200675e85a2826f676df4be3061";
const site = (process.env.BAMIO_APP_URL || "https://bamio.app").replace(/\/+$/, "");
const host = new URL(site).host;

const sitemap = await (await fetch(`${site}/sitemap.xml`)).text();
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
if (urls.length === 0) throw new Error(`No URLs in ${site}/sitemap.xml`);
const keyFile = await fetch(`${site}/${KEY}.txt`);
if (!keyFile.ok || (await keyFile.text()).trim() !== KEY) throw new Error(`${site}/${KEY}.txt doesn't serve the key yet: deploy first.`);

const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host, key: KEY, keyLocation: `${site}/${KEY}.txt`, urlList: urls }),
});
// 200: accepted; 202: accepted, key check pending.
if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
console.log(`✓ IndexNow: ${urls.length} pages submitted for ${host} (${res.status})`);
for (const u of urls) console.log(`  ${u}`);
