import { expect, test, type Page } from "@playwright/test";
import { CONTACT_EMAIL } from "../../src/lib/contact";
import { signIn } from "./auth";
import { clearCampaigns, connect, DEMO, seedCampaign } from "./campaign-seed";

/*
 * Clipping campaigns: the public pages, someone with content asking to run a campaign, then a
 * clipper joining, sending clips and seeing what they earn (an admin's part done in the
 * database). The tests that do the admin's part in the admin panel need the e2e user to be an
 * admin (E2E_ADMIN=1, with the server's BAMIO_SUPERADMINS naming it: see admin.spec.ts).
 */

const sql = connect();
test.afterAll(async () => {
  await clearCampaigns(sql);
  await sql.end();
});
const userId = (page: Page) => page.evaluate(() => (window as unknown as { Clerk: { user: { id: string } } }).Clerk.user.id);
const NAME = "Bamio E2E Clipper";
const REEL = (n: number) => `https://www.instagram.com/reel/E2Esent0000${n}/`;

test("campaigns are public: what each pays, its budget and who has earned the most", async ({ page }) => {
  await seedCampaign(sql);
  const res = await page.goto("/clippers");
  expect(res?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: "get paid to clip." })).toBeVisible();
  const card = page.getByRole("link", { name: new RegExp(DEMO.title) });
  await expect(card).toContainText("$2 per 1,000 views");
  // Nova's 152,300 views and the other clipper's 48,000, at $2 per 1,000.
  await expect(card).toContainText("$400.60 of $1,000 used");
  await expect(card).toContainText("2 clippers");
  await page.screenshot({ path: "qa/campaigns/campaigns.png", fullPage: true });

  await card.click();
  await expect(page).toHaveURL(new RegExp(`/clippers/${DEMO.slug}$`));
  await expect(page.getByRole("heading", { level: 1, name: DEMO.title })).toBeVisible();
  await expect(page.getByText("Tag @testcreator in the caption")).toBeVisible();
  await expect(page.getByText("Test Creator pays clippers directly.")).toBeVisible();
  const leaders = page.getByRole("list").filter({ has: page.getByText("Nova Clips") }).getByRole("listitem");
  await expect(leaders).toHaveCount(2);
  await expect(leaders.first()).toContainText("Nova Clips");
  await expect(leaders.first()).toContainText("$304.60");
  const channel = leaders.first().getByRole("link", { name: /nova\.clips/ });
  await expect(channel).toHaveAttribute("href", "https://tiktok.com/@nova.clips");
  await expect(channel).toHaveAttribute("rel", /nofollow/);
  // The content opens in Bamio's importer.
  await expect(page.getByRole("link", { name: "Clip it with Bamio" })).toHaveAttribute("href", `/new?url=${encodeURIComponent("https://www.youtube.com/watch?v=jNQXAC9IVRw")}`);
  // Signed out: an invitation, and the way back here after signing in.
  await expect(page.getByRole("link", { name: "Sign in to join" })).toHaveAttribute("href", `/sign-in?redirect_url=${encodeURIComponent(`/clippers/${DEMO.slug}`)}`);
  await page.screenshot({ path: "qa/campaigns/campaign.png", fullPage: true });

  // A draft and an address that was never a campaign don't exist for visitors.
  expect((await page.goto("/clippers/no-such-campaign"))?.status()).toBe(404);
  await sql`update campaigns set status = 'draft' where id = ${DEMO.id}`;
  expect((await page.goto(`/clippers/${DEMO.slug}`))?.status()).toBe(404);
  await page.goto("/clippers");
  await expect(page.getByRole("link", { name: new RegExp(DEMO.title) })).toHaveCount(0);
});

test("the campaigns page invites podcasters, streamers and businesses to run a campaign", async ({ page }) => {
  await page.goto("/clippers");
  await expect(page.getByRole("link", { name: "Run a campaign", exact: true })).toHaveAttribute("href", "#run");
  const section = page.getByRole("region", { name: "Run a campaign" });
  for (const who of ["Podcasters", "Streamers", "Businesses"]) await expect(section.getByRole("heading", { name: who })).toBeVisible();
  await expect(section.getByText("We check it and open it")).toBeVisible();
  // Where to write with a question first, here and in the footer.
  await expect(section.getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  await expect(page.getByRole("contentinfo").getByRole("link", { name: CONTACT_EMAIL })).toHaveAttribute("href", `mailto:${CONTACT_EMAIL}`);
  // Signed out: the form is behind signing in, which comes back to it.
  await expect(section.getByRole("link", { name: "Sign in to set up a campaign" })).toHaveAttribute("href", `/sign-in?redirect_url=${encodeURIComponent("/clippers?run=1")}`);
  await expect(section.getByLabel("Your content")).toHaveCount(0);
  expect((await page.request.post("/api/campaign-requests", { data: {} })).status()).toBe(401);
});

test.describe("someone with content to clip", () => {
  let id = "";
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    id = await userId(page);
    await clearCampaigns(sql, id);
  });
  test.afterEach(async () => {
    if (id) await clearCampaigns(sql, id);
  });

  test("asks to run a campaign with the form, and can take it back while it waits", async ({ page }) => {
    await page.goto("/clippers?run=1");
    const section = page.getByRole("region", { name: "Run a campaign" });
    await expect(section.getByRole("heading", { name: "Your campaign" })).toBeVisible();
    // The form says what's missing before anything is sent.
    await section.getByRole("button", { name: "Send it to Bamio’s team" }).click();
    await expect(section.getByText("An amount in dollars, like 2 or 1.50.")).toBeVisible();
    await expect(section.getByText("Add a link to your content, like youtube.com/@yourshow.")).toBeVisible();
    await page.screenshot({ path: "qa/campaigns/run-form.png", fullPage: true });

    await section.getByRole("button", { name: "Streamer" }).click();
    await section.getByLabel("Your channel’s name").fill("E2E Stream House");
    await section.getByLabel("Your content").fill("twitch.tv/e2e_stream_house");
    await section.getByLabel("What should clippers clip?").fill("The best play or reaction from each stream, under a minute.");
    await section.getByRole("button", { name: "X", exact: true }).click();
    await section.getByLabel("You pay per 1,000 views ($)").fill("1.50");
    await section.getByLabel("Your budget ($)").fill("400");
    await section.getByLabel("How you’ll pay clippers").fill("PayPal, every Friday");
    await section.getByRole("button", { name: "Send it to Bamio’s team" }).click();
    await expect(page.getByText("Sent to Bamio’s team")).toBeVisible();

    // It waits for the team, and shows where it stands.
    const row = section.getByRole("listitem").filter({ hasText: "E2E Stream House" });
    await expect(row).toContainText("Streamer · $1.50 per 1,000 views · $400 budget");
    await expect(row).toContainText("Waiting for a look");
    expect(await sql`select kind, name, source_url, platforms, rate_cents, budget_cents, payout, status, email from campaign_requests where user_id = ${id}`).toMatchObject([
      { kind: "streamer", name: "E2E Stream House", source_url: "https://twitch.tv/e2e_stream_house", platforms: ["tiktok", "youtube", "instagram", "x"], rate_cents: 150, budget_cents: 40000, payout: "PayPal, every Friday", status: "pending", email: expect.stringContaining("@") },
    ]);
    await page.screenshot({ path: "qa/campaigns/run-waiting.png", fullPage: true });

    await row.getByRole("button", { name: "Take back" }).click();
    await expect(page.getByText("Request taken back")).toBeVisible();
    await expect(section.getByRole("listitem").filter({ hasText: "E2E Stream House" })).toHaveCount(0);
    expect((await sql`select 1 from campaign_requests where user_id = ${id}`).length).toBe(0);
  });

  test("hears no when it's declined, and sees the campaign once an admin makes it and opens it", async ({ page }) => {
    test.skip(!process.env.E2E_ADMIN, "Set E2E_ADMIN=1, with the server's BAMIO_SUPERADMINS naming the e2e user.");
    const ask = (name: string) =>
      page.request.post("/api/campaign-requests", {
        data: { kind: "podcaster", name, sourceUrl: "youtube.com/@e2e_show", brief: "The funniest minute of each episode, with captions on.", platforms: ["tiktok", "youtube"], rateCents: 200, budgetCents: 30000, payout: "PayPal, monthly", contact: "discord: e2e" },
      });
    expect((await ask("E2E Show One")).status()).toBe(201);
    expect((await ask("E2E Show Two")).status()).toBe(201);

    // The team sees both, the first one asked at the top.
    await page.goto("/admin/campaigns");
    await expect(page.getByRole("heading", { name: "Requests to run a campaign" })).toBeVisible();
    const one = page.getByRole("row").filter({ hasText: "E2E Show One" });
    const two = page.getByRole("row").filter({ hasText: "E2E Show Two" });
    await expect(one).toContainText("$2");
    await expect(one).toContainText("PayPal, monthly");
    await expect(one).toContainText("discord: e2e");
    await page.screenshot({ path: "qa/campaigns/admin-requests.png", fullPage: true });

    // Declined, with a word why.
    await two.getByRole("button", { name: "Decline" }).click();
    await page.getByRole("dialog").getByLabel("Why (they’re emailed this)").fill("We couldn’t tell the channel is yours.");
    await page.getByRole("dialog").getByRole("button", { name: "Decline" }).click();
    await expect(page.getByText("E2E Show Two’s request declined")).toBeVisible();
    await expect(two.getByText("Declined", { exact: true })).toBeVisible();

    // Accepted: the form starts from what they said; the admin adds the title and the one line.
    await one.getByRole("link", { name: "Make the campaign" }).click();
    await expect(page.getByText("From E2E Show One’s request")).toBeVisible();
    await expect(page.getByLabel("Whose campaign")).toHaveValue("E2E Show One");
    await expect(page.getByLabel("What to clip")).toHaveValue("The funniest minute of each episode, with captions on.");
    await expect(page.getByLabel("Per 1,000 views ($)")).toHaveValue("2");
    await expect(page.getByLabel("Budget ($)")).toHaveValue("300");
    await expect(page.getByLabel("The content")).toHaveValue("https://youtube.com/@e2e_show");
    await page.getByLabel("Title").fill("E2E requested campaign");
    await page.getByLabel("One line").fill("Clip the funniest minute of the E2E show.");
    await page.getByRole("button", { name: "Make the draft" }).click();
    await page.waitForURL(/admin.campaigns.[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "Asked for by" })).toBeVisible();
    await expect(page.getByText("E2E Show One (Podcaster)")).toBeVisible();

    // Still a draft: "Being set up". Live: they see it, and are emailed once.
    await page.goto("/clippers");
    const mine = page.getByRole("region", { name: "Run a campaign" }).getByRole("listitem");
    await expect(mine.filter({ hasText: "E2E Show One" })).toContainText("Being set up");
    await expect(mine.filter({ hasText: "E2E Show Two" })).toContainText("Not opened");
    await expect(mine.filter({ hasText: "E2E Show Two" })).toContainText("We couldn’t tell the channel is yours.");
    await page.goBack();
    await page.getByRole("button", { name: "Go live" }).click();
    await expect(page.getByText("The campaign is open")).toBeVisible();
    await page.goto("/clippers");
    await expect(mine.filter({ hasText: "E2E Show One" }).getByRole("link", { name: "See it" })).toHaveAttribute("href", "/clippers/e2e-requested-campaign");
    await expect(page.getByRole("link", { name: /E2E requested campaign/ })).toBeVisible();
    const emails = await sql<{ template: string }[]>`select template from emails where user_id = ${id} and template in ('campaign-live', 'campaign-declined') order by template`;
    expect(emails.map((e) => e.template)).toEqual(["campaign-declined", "campaign-live"]);
    await sql`delete from emails where user_id = ${id} and template in ('campaign-live', 'campaign-declined')`;
  });
});

test.describe("a clipper", () => {
  let id = "";
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    id = await userId(page);
    await clearCampaigns(sql, id);
  });
  test.afterEach(async () => {
    if (id) await clearCampaigns(sql, id);
  });

  test("joins a campaign, sends clips, and sees what they earn and are paid", async ({ page }) => {
    await seedCampaign(sql);
    await page.goto(`/clippers/${DEMO.slug}`);
    await expect(page.getByRole("heading", { name: "Join this campaign" })).toBeVisible();
    await page.getByLabel("Your name as a clipper").fill(NAME);
    // Only channels on sites Bamio knows.
    await page.getByLabel("Your channel").fill("https://example.com/me");
    await page.getByRole("button", { name: "Join the campaign" }).click();
    await expect(page.getByText("Use a link to your channel on TikTok, YouTube, Instagram, X, Twitch or Kick.")).toBeVisible();
    await page.getByLabel("Your channel").fill("tiktok.com/@bamio_e2e");
    await page.getByLabel("How to pay you").fill("PayPal: e2e@example.com");
    await page.getByRole("button", { name: "Join the campaign" }).click();
    await expect(page.getByRole("heading", { name: "Your clips" })).toBeVisible();
    expect(await sql`select name, link, payout from clippers where user_id = ${id}`).toMatchObject([{ name: NAME, link: "https://tiktok.com/@bamio_e2e", payout: "PayPal: e2e@example.com" }]);

    // A clip is a post on one of the campaign's sites.
    const field = page.getByLabel("Send a clip you posted");
    const send = page.getByRole("button", { name: "Send", exact: true });
    await field.fill("https://example.com/video");
    await send.click();
    await expect(page.getByText("Paste the link to your clip’s own page on TikTok, Instagram Reels.")).toBeVisible();
    await field.fill("https://www.youtube.com/shorts/jNQXAC9IVRw");
    await send.click();
    await expect(page.getByText("This campaign takes clips posted on TikTok, Instagram Reels.")).toBeVisible();
    await field.fill(`${REEL(1)}?igsh=abc`);
    await send.click();
    await expect(page.getByText("Clip sent")).toBeVisible();
    const clips = page.getByRole("list", { name: "Clips you sent" }).getByRole("listitem");
    await expect(clips).toHaveCount(1);
    await expect(clips.first()).toContainText("Waiting for a look");
    await expect(clips.first()).toContainText("Views added by the team");
    expect(await sql`select url, status from campaign_clips where user_id = ${id}`).toMatchObject([{ url: REEL(1), status: "pending" }]);

    // The same post twice: refused. A second clip can be taken back while it waits.
    await field.fill(REEL(1));
    await send.click();
    await expect(page.getByText("That clip was already sent to this campaign.")).toBeVisible();
    await field.fill(REEL(2));
    await send.click();
    await expect(clips).toHaveCount(2);
    await clips.first().getByRole("button", { name: "Take back" }).click();
    await expect(clips).toHaveCount(1);
    await expect(page.getByRole("listitem").filter({ hasText: NAME })).toHaveCount(0); // not on the leaderboard yet

    // An admin approves it and types in its views (the admin panel's part: see the last test), then records a payment.
    await sql`update campaign_clips set status = 'approved', reviewed_at = ${Date.now()}, reviewed_by = 'e2e@example.com', views_manual = 25000 where user_id = ${id}`;
    await page.reload();
    await expect(clips.first()).toContainText("Counting");
    await expect(clips.first()).toContainText("25K views · $50");
    const totals = page.getByRole("complementary").getByRole("definition");
    await expect(totals).toHaveText(["$50", "$0", "$50"]);
    const row = page.getByRole("listitem").filter({ hasText: NAME });
    await expect(row).toContainText("$50");
    await expect(row.getByRole("link", { name: /bamio_e2e/ })).toHaveAttribute("href", "https://tiktok.com/@bamio_e2e");
    await sql`insert into campaign_payouts (campaign_id, user_id, amount_cents, note, paid_by, paid_at) values (${DEMO.id}, ${id}, 3000, '', 'e2e@example.com', ${Date.now()})`;
    await page.reload();
    await expect(totals).toHaveText(["$50", "$30", "$20"]);
    await page.screenshot({ path: "qa/campaigns/campaign-joined.png", fullPage: true });

    // Their campaigns are on the campaigns page, and their details in their profile.
    await page.goto("/clippers");
    const mine = page.getByRole("region", { name: "Your campaigns" }).getByRole("link", { name: new RegExp(DEMO.title) });
    await expect(mine).toContainText("1 clip");
    await expect(mine).toContainText("$50 earned · $20 to come");
    await page.goto("/profile/clipper");
    await expect(page.getByRole("heading", { name: "Clipper details" })).toBeVisible();
    await expect(page.getByLabel("Your name as a clipper")).toHaveValue(NAME);
    await page.getByLabel("How to pay you").fill("Wise: e2e@example.com");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Clipper details saved")).toBeVisible();
    expect(await sql`select payout from clippers where user_id = ${id}`).toMatchObject([{ payout: "Wise: e2e@example.com" }]);
  });

  test("can't join or send clips once a campaign has ended, and a blocked clipper is told", async ({ page }) => {
    await seedCampaign(sql, { joined: id });
    await sql`update campaigns set status = 'ended' where id = ${DEMO.id}`;
    await page.goto(`/clippers/${DEMO.slug}`);
    await expect(page.getByText("This campaign has ended, so it takes no more clips.")).toBeVisible();
    await expect(page.getByLabel("Send a clip you posted")).toHaveCount(0);
    // What they earned stays, and a rejected clip says why.
    await expect(page.getByRole("complementary").getByRole("definition")).toHaveText(["$50", "$30", "$20"]);
    await expect(page.getByText("Not from this campaign’s content.")).toBeVisible();
    const sent = await page.request.post(`/api/campaigns/${DEMO.slug}/clips`, { data: { url: REEL(3) } });
    expect(sent.status()).toBe(409);

    await sql`update clippers set blocked_at = ${Date.now()} where user_id = ${id}`;
    await page.reload();
    await expect(page.getByText("Your account can’t take part in campaigns")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: NAME })).toHaveCount(0);
  });

  test("an admin sets up a campaign, looks at a clip and records a payment", async ({ page }) => {
    test.skip(!process.env.E2E_ADMIN, "Set E2E_ADMIN=1, with the server's BAMIO_SUPERADMINS naming the e2e user.");
    await page.goto("/admin/campaigns");
    await page.getByRole("link", { name: "New campaign" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "New campaign" })).toBeVisible();

    // The form says what's missing before anything is saved.
    await page.getByRole("button", { name: "Make the draft" }).click();
    await expect(page.getByText("An amount in dollars, like 2 or 1.50.")).toBeVisible();
    await page.getByLabel("Title").fill("E2E admin campaign");
    await page.getByLabel("Whose campaign").fill("Test Creator");
    await page.getByLabel("One line").fill("Clip the admin panel’s test stream.");
    await page.getByLabel("What to clip").fill("Any moment from the stream worth a second look.");
    await page.getByLabel("Rules").fill("Post it on your own channel\nTag @testcreator");
    await page.getByLabel("Instagram Reels").check();
    await page.getByLabel("Per 1,000 views ($)").fill("2.50");
    await page.getByLabel("Budget ($)").fill("100");
    await page.getByLabel("How clippers are paid").fill("Paid on Fridays by PayPal.");
    await page.getByRole("button", { name: "Make the draft" }).click();
    await page.waitForURL(/\/admin\/campaigns\/[0-9a-f-]{36}$/);
    const adminPath = new URL(page.url()).pathname;
    await expect(page.getByRole("heading", { level: 1, name: "E2E admin campaign" })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    // A draft isn't listed; live, it is.
    await page.goto("/clippers");
    await expect(page.getByRole("link", { name: /E2E admin campaign/ })).toHaveCount(0);
    await page.goto(adminPath);
    await page.getByRole("button", { name: "Go live" }).click();
    await expect(page.getByText("The campaign is open")).toBeVisible();

    // The same person joins as a clipper and sends a clip.
    await page.goto("/clippers/e2e-admin-campaign");
    await page.getByLabel("Your name as a clipper").fill(NAME);
    await page.getByLabel("Your channel").fill("tiktok.com/@bamio_e2e");
    await page.getByLabel("How to pay you").fill("PayPal: e2e@example.com");
    await page.getByRole("button", { name: "Join the campaign" }).click();
    await page.getByLabel("Send a clip you posted").fill(REEL(7));
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByText("Clip sent")).toBeVisible();

    // Approve it and type its views in: 20,000 views at $2.50 per 1,000.
    await page.goto(adminPath);
    const clip = page.getByRole("row").filter({ hasText: "E2Esent00007" });
    await expect(clip.getByText("Waiting", { exact: true })).toBeVisible();
    await expect(clip).toContainText("needs typing in");
    await clip.getByRole("button", { name: "Approve" }).click();
    await expect(clip.getByText("Counting", { exact: true })).toBeVisible();
    await clip.getByRole("button", { name: "Set views" }).click();
    await page.getByRole("dialog").getByLabel("Views").fill("20000");
    await page.getByRole("dialog").getByRole("button", { name: "Save views" }).click();
    await expect(clip).toContainText("20,000");
    await expect(clip).toContainText("$50");

    // They're owed $50: record $30 of it, never more than is owed.
    const clipper = page.getByRole("row").filter({ hasText: "PayPal: e2e@example.com" });
    await clipper.getByRole("button", { name: "Mark paid" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByLabel("Amount paid ($)")).toHaveValue("50");
    await dialog.getByLabel("Amount paid ($)").fill("80");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(dialog.getByText("They’re owed $50. Record that much or less.")).toBeVisible();
    await dialog.getByLabel("Amount paid ($)").fill("30");
    await dialog.getByLabel("Note (they’ll see this)").fill("PayPal, today");
    await dialog.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByText(`$30 to ${NAME} recorded`)).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "PayPal, today" })).toContainText("$30");
    await expect(clipper).toContainText("$20");
    // The clipper is told (the email is written, not sent, on a test server).
    expect((await sql`select template from emails where user_id = ${id} and template = 'campaign-paid'`).length).toBe(1);
    await page.screenshot({ path: "qa/campaigns/admin-campaign.png", fullPage: true });

    // Ended: shown as finished, taking nothing more.
    await page.getByRole("button", { name: "End", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "End campaign" }).click();
    await expect(page.getByText("The campaign has ended")).toBeVisible();
    await page.goto("/clippers/e2e-admin-campaign");
    await expect(page.getByText("This campaign has ended, so it takes no more clips.")).toBeVisible();
    await sql`delete from emails where user_id = ${id} and template = 'campaign-paid'`;
  });
});
