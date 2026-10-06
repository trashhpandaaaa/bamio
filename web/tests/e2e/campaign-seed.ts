import postgres from "postgres";

/*
 * A clipping campaign for the browser tests to look at, written straight into the database:
 * open, with two clippers who have earned something and been partly paid. Their clips are on
 * Instagram, whose views Bamio never reads itself, so the server's view counter leaves them
 * alone. Everything the tests make has an address starting "e2e-", and clearCampaigns removes it.
 */

export const connect = () => postgres(process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/bamio", { onnotice: () => undefined, max: 2 });
type Sql = ReturnType<typeof connect>;

export const DEMO = { id: "0c0ffee0-0000-4000-8000-0000000e2e01", slug: "e2e-demo-campaign", title: "E2E demo campaign", brand: "Test Creator" };

const NOVA = "user_e2e_campaign_nova";
const LONG = "user_e2e_campaign_long";

/** `joined`: also make this user a member, with a clip in each state and a payment. */
export async function seedCampaign(sql: Sql, opts: { joined?: string } = {}) {
  await clearCampaigns(sql, opts.joined);
  const now = Date.now();
  await sql`insert into campaigns (id, slug, title, brand, summary, brief, rules, source_url, platforms, rate_cents, budget_cents, min_views, max_clip_cents, payout, status, ends_at, created_by, created_at, updated_at)
    values (${DEMO.id}, ${DEMO.slug}, ${DEMO.title}, ${DEMO.brand}, 'Clip the best moments of the weekly test stream.',
      ${"Anything from this month’s streams that makes people stop scrolling: clutches, fails, big reactions.\nKeep clips under a minute, with captions on."},
      ${"Post it on your own channel\nTag @testcreator in the caption\nNo reuploads of other people’s clips"},
      'https://www.youtube.com/watch?v=jNQXAC9IVRw', '["tiktok", "instagram"]', 200, 100000, 1000, 50000,
      'Paid every Friday by PayPal or Wise, for everything earned up to Thursday.', 'live', ${now + 30 * 86_400_000}, 'e2e@example.com', ${now}, ${now})`;
  const clipper = (id: string, name: string, link: string, payout: string) =>
    sql`insert into clippers (user_id, name, link, payout, created_at, updated_at) values (${id}, ${name}, ${link}, ${payout}, ${now}, ${now})`;
  const member = (id: string) => sql`insert into campaign_members (campaign_id, user_id, joined_at) values (${DEMO.id}, ${id}, ${now})`;
  const clip = (id: string, code: string, status: string, views: number | null, note: string | null = null) =>
    sql`insert into campaign_clips (campaign_id, user_id, url, url_key, platform, status, note, views_manual, reviewed_by, reviewed_at, created_at)
      values (${DEMO.id}, ${id}, ${`https://www.instagram.com/reel/${code}/`}, ${`instagram:${code}`}, 'instagram', ${status}, ${note}, ${views},
        ${status === "pending" ? null : "e2e@example.com"}, ${status === "pending" ? null : now}, ${now})`;
  await clipper(NOVA, "Nova Clips", "https://tiktok.com/@nova.clips", "PayPal: nova@example.com");
  await clipper(LONG, "A clipper whose name runs rather long ok", "https://instagram.com/a.rather.long.channel.handle", "");
  await member(NOVA);
  await member(LONG);
  await clip(NOVA, "E2Enova00001", "approved", 152_300);
  await clip(LONG, "E2Elong00001", "approved", 48_000);
  await clip(LONG, "E2Elong00002", "pending", null);
  await sql`insert into campaign_payouts (campaign_id, user_id, amount_cents, note, paid_by, paid_at) values (${DEMO.id}, ${NOVA}, 10000, 'PayPal, Friday', 'e2e@example.com', ${now})`;
  if (opts.joined) {
    await clipper(opts.joined, "Bamio E2E Clipper", "https://tiktok.com/@bamio_e2e", "PayPal: e2e@example.com");
    await member(opts.joined);
    await clip(opts.joined, "E2Emine00001", "approved", 25_000);
    await clip(opts.joined, "E2Emine00002", "pending", null);
    await clip(opts.joined, "E2Emine00003", "rejected", null, "Not from this campaign’s content.");
    await sql`insert into campaign_payouts (campaign_id, user_id, amount_cents, note, paid_by, paid_at) values (${DEMO.id}, ${opts.joined}, 3000, '', 'e2e@example.com', ${now})`;
  }
}

/** Remove every test campaign (with its members, clips and payments), the made-up clippers and, when given, the e2e user's clipper. */
export async function clearCampaigns(sql: Sql, userId?: string) {
  await sql`delete from campaigns where slug like 'e2e-%'`;
  await sql`delete from clippers where user_id in ${sql([NOVA, LONG, ...(userId ? [userId] : [])])}`;
}
