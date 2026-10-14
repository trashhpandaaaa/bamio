// Tell every Bamio account that clipping campaigns are open: one "campaigns-open" email each
// (src/lib/email/templates.ts, category "news", which people can turn off under Notifications),
// listing the campaigns live right now. Queued for the workers' mailer, which sends one at a time,
// skips Clerk test users and anyone who turned news off. Each account gets it once (the key).
//
//   node scripts/announce-campaigns.mjs          what would be sent, and to how many
//   node scripts/announce-campaigns.mjs --send   queue it
//
// Needs DATABASE_URL and CLERK_SECRET_KEY (on the Droplet: docker compose exec -T app node scripts/announce-campaigns.mjs).
import { createClerkClient } from "@clerk/backend";
import postgres from "postgres";

const KEY = "news:campaigns-open:2026-10";
const send = process.argv.includes("--send");
const AUDIENCES = { worldwide: "anywhere", europe: "in Europe", asia: "in Asia", north_america: "in North America", latin_america: "in Latin America", africa: "in Africa", oceania: "in Oceania" };
const dollars = (cents) => `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;

if (!process.env.DATABASE_URL || !process.env.CLERK_SECRET_KEY) {
  console.error("Set DATABASE_URL and CLERK_SECRET_KEY.");
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => undefined });
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

const live = await sql`select title, slug, rate_cents, max_clipper_cents, audience from campaigns where status = 'live' order by created_at limit 6`;
if (live.length === 0) {
  console.error("No campaign is live: nothing to announce.");
  await sql.end();
  process.exit(1);
}
const campaigns = live.map((c) => ({
  title: c.title,
  slug: c.slug,
  meta: [`${dollars(c.rate_cents)} per 1,000 views`, c.max_clipper_cents ? `up to ${dollars(c.max_clipper_cents)} a clipper` : null, `audience ${AUDIENCES[c.audience] ?? "anywhere"}`].filter(Boolean).join(", "),
}));
const data = { template: "campaigns-open", campaigns };

// Every account, a page at a time.
const users = [];
for (let offset = 0; ; offset += 100) {
  const page = await clerk.users.getUserList({ limit: 100, offset, orderBy: "created_at" });
  users.push(...page.data);
  if (page.data.length < 100) break;
}
const real = users.filter((u) => !u.banned && !u.emailAddresses.every((e) => /\+clerk_test@/i.test(e.emailAddress)));
const off = real.filter((u) => u.unsafeMetadata?.bamioNotifications?.news === false).length;

console.log(`Campaigns in the email:\n${campaigns.map((c) => `  ${c.title}: ${c.meta}`).join("\n")}`);
console.log(`Accounts: ${users.length}; real ones: ${real.length}; news turned off: ${off} (the mailer skips them).`);

if (!send) {
  console.log("Nothing queued. Run again with --send to queue it.");
  await sql.end();
  process.exit(0);
}

const now = Date.now();
let queued = 0;
for (const [i, u] of real.entries()) {
  // Spread out, a little over one a second, so the mail provider's rate limit is never hit.
  const at = now + i * 1200;
  const rows = await sql`
    insert into emails (user_id, key, template, category, data, run_after, created_at, updated_at)
    values (${u.id}, ${KEY}, 'campaigns-open', 'news', ${sql.json(data)}, ${at}, ${now}, ${now})
    on conflict (user_id, key) do nothing returning id`;
  queued += rows.length;
}
await sql`select pg_notify('bamio_emails', '')`;
console.log(`Queued ${queued} (${real.length - queued} already had it). The mailer sends them over about ${Math.ceil((real.length * 1.2) / 60)} minutes.`);
await sql.end();
