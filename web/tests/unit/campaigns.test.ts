import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { channelLink, clipLink, type ClipLink } from "@/lib/campaigns/links";
import { clipEarned, compactNumber, settle } from "@/lib/campaigns/money";
import { campaignInputSchema, campaignRequestSchema, clipperInputSchema, parseDollars, slugify, type CampaignInput, type CampaignRequestInput } from "@/lib/campaigns/schema";
import type { Admin } from "@/lib/server/admin";
import {
  adminCampaignRequests,
  createCampaignFromRequest,
  declineCampaignRequest,
  myCampaignRequests,
  requestCampaign,
  requestOfCampaign,
  waitingRequests,
  withdrawCampaignRequest,
} from "@/lib/server/campaign-requests";
import { assertCampaignAccess, campaignAccess, canSeeCampaigns } from "@/lib/server/campaign-access";
import { countNextViews } from "@/lib/server/campaign-views";
import {
  adminCampaign,
  adminCampaigns,
  blockClipper,
  campaignBySlug,
  campaignCounts,
  campaignRef,
  createCampaign,
  deleteCampaign,
  endDueCampaigns,
  joinCampaign,
  listCampaigns,
  myCampaign,
  myCampaigns,
  myClipper,
  openCampaignCount,
  recordPayout,
  recountClip,
  resolveClipLink,
  reviewClip,
  setCampaignStatus,
  setClipViews,
  submitClip,
  updateCampaign,
  withdrawClip,
} from "@/lib/server/campaigns";
import { db } from "@/lib/server/db";

/* Clipping campaigns: which links count as a clip, what views are worth, and the whole round from a draft to a recorded payment. */

// The admin module (the log of changes) loads Clerk: not needed here.
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }), clerkClient: async () => ({ users: {} }) }));

const MIRA = "user_camp_mira";
const OTTO = "user_camp_otto";
const boss: Admin = { userId: "user_camp_boss", email: "boss@example.com", role: "admin" };
const TITLE = "Unit Test Campaign";

const input = (over: Partial<CampaignInput> = {}): CampaignInput =>
  campaignInputSchema.parse({
    title: TITLE,
    brand: "Test Creator",
    summary: "Clip the best moments of the test stream.",
    brief: "Any moment from the stream that makes people stop scrolling.",
    rules: "Post it on your own channel\n\n  Tag   @testcreator ",
    sourceUrl: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    platforms: ["youtube", "tiktok"],
    rateCents: 200,
    budgetCents: 10_000,
    minViews: 1000,
    maxClipCents: null,
    payout: "Paid every Friday by PayPal.",
    endsAt: null,
    ...over,
  });

const mira = { name: "Mira Clips", link: "tiktok.com/@mira.clips", payout: "PayPal: mira@example.com" };
const otto = { name: "Otto", link: "https://www.youtube.com/@otto", payout: "" };
const TIKTOK = (n: number) => `https://www.tiktok.com/@mira.clips/video/73000000000000000${n}`;

async function clean() {
  const sql = db();
  await sql`delete from campaigns where title like ${`${TITLE}%`}`;
  for (const u of [MIRA, OTTO]) {
    await sql`delete from clippers where user_id = ${u}`;
    await sql`delete from emails where user_id = ${u}`;
    await sql`delete from campaign_requests where user_id = ${u}`;
  }
  await sql`delete from admin_actions where admin_user_id = ${boss.userId}`;
}

const clipIds = async (campaignId: string) => (await db()<{ id: number }[]>`select id::int as id from campaign_clips where campaign_id = ${campaignId} order by id`).map((r) => r.id);

describe("a clipper's channel link", () => {
  it("is a channel on a platform Bamio knows, tidied", () => {
    expect(channelLink("twitch.tv/mira_clips")).toEqual({ url: "https://twitch.tv/mira_clips", platform: "twitch", handle: "mira_clips" });
    expect(channelLink(" https://www.youtube.com/@MiraClips/?sub=1#x ")).toEqual({ url: "https://youtube.com/@MiraClips", platform: "youtube", handle: "MiraClips" });
    expect(channelLink("https://twitter.com/mira")).toMatchObject({ url: "https://x.com/mira", platform: "x" });
    expect(channelLink("m.tiktok.com/@mira.clips")).toMatchObject({ platform: "tiktok", handle: "mira.clips" });
    expect(channelLink("instagram.com/mira/")?.url).toBe("https://instagram.com/mira");
  });

  it("is refused anywhere else, or when it isn't a channel", () => {
    for (const bad of ["", "https://example.com/mira", "https://twitch.tv", "javascript:alert(1)", "https://evil.com/twitch.tv/mira", "https://twitch.tv.evil.com/mira", "https://user:pw@twitch.tv/mira", "https://twitch.tv/mi ra", "https://twitch.tv/%zz", "https://twitch.tv/<script>"]) {
      expect(channelLink(bad), bad).toBeNull();
    }
  });
});

describe("a clip's link", () => {
  it("is one post on TikTok, YouTube, Instagram or X, the same however it was written", () => {
    expect(clipLink("https://www.tiktok.com/@mira.clips/video/7300000000000000001?is_from_webapp=1&lang=en")).toEqual({
      url: "https://www.tiktok.com/@mira.clips/video/7300000000000000001",
      platform: "tiktok",
      key: "tiktok:7300000000000000001",
      short: false,
    });
    expect(clipLink("m.tiktok.com/@mira.clips/video/7300000000000000001")?.key).toBe("tiktok:7300000000000000001");
    expect(clipLink("https://youtube.com/shorts/jNQXAC9IVRw?feature=share")).toMatchObject({ url: "https://www.youtube.com/shorts/jNQXAC9IVRw", key: "youtube:jNQXAC9IVRw" });
    expect(clipLink("https://youtu.be/jNQXAC9IVRw?si=abc")).toMatchObject({ url: "https://www.youtube.com/watch?v=jNQXAC9IVRw", key: "youtube:jNQXAC9IVRw" });
    expect(clipLink("https://m.youtube.com/watch?v=jNQXAC9IVRw&t=4s")?.key).toBe("youtube:jNQXAC9IVRw");
    expect(clipLink("https://www.instagram.com/reel/C8abcDEF_-1/?igsh=xyz")).toMatchObject({ url: "https://www.instagram.com/reel/C8abcDEF_-1/", platform: "instagram", key: "instagram:C8abcDEF_-1" });
    expect(clipLink("instagram.com/mira/reel/C8abcDEF_-1")?.key).toBe("instagram:C8abcDEF_-1");
    expect(clipLink("https://twitter.com/mira/status/1790000000000000000?s=20")).toMatchObject({ url: "https://x.com/mira/status/1790000000000000000", platform: "x", key: "x:1790000000000000000" });
    expect(clipLink("https://mobile.twitter.com/i/web/status/1790000000000000000")?.key).toBe("x:1790000000000000000");
  });

  it("marks TikTok's share links as needing to be followed", () => {
    expect(clipLink("https://vm.tiktok.com/ZMabc123/")).toEqual({ url: "https://vm.tiktok.com/ZMabc123/", platform: "tiktok", key: "tiktok:t:ZMabc123", short: true });
    expect(clipLink("https://www.tiktok.com/t/ZTabc123")?.short).toBe(true);
  });

  it("is refused when it isn't a post, or is anywhere else", () => {
    for (const bad of [
      "",
      "https://www.tiktok.com/@mira.clips",
      "https://www.tiktok.com/@mira.clips/photo/7300000000000000001",
      "https://www.youtube.com/@mira",
      "https://www.youtube.com/shorts/short",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.instagram.com/mira/",
      "https://x.com/mira",
      "https://x.com/status/1790000000000000000",
      "https://example.com/@mira/video/7300000000000000001",
      "https://tiktok.com.evil.com/@mira/video/7300000000000000001",
      "https://user:pw@www.tiktok.com/@mira/video/7300000000000000001",
      "https://www.tiktok.com:8080/@mira/video/7300000000000000001",
      "javascript:alert(1)",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      expect(clipLink(bad), bad).toBeNull();
    }
  });

  it("follows a share link only to another TikTok link", async () => {
    const short = clipLink("https://vm.tiktok.com/ZMabc123/") as ClipLink;
    const fetchMock = vi.spyOn(globalThis, "fetch");
    try {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: "https://www.tiktok.com/@mira.clips/video/7300000000000000001?_r=1" } }));
      expect(await resolveClipLink(short)).toMatchObject({ key: "tiktok:7300000000000000001", short: false });
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://vm.tiktok.com/ZMabc123/");
      expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
      // Somewhere else, nowhere at all, or an error: not a clip.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } }));
      expect(await resolveClipLink(short)).toBeNull();
      fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
      expect(await resolveClipLink(short)).toBeNull();
      fetchMock.mockRejectedValueOnce(new Error("offline"));
      expect(await resolveClipLink(short)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(4);
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe("what views are worth", () => {
  const terms = { rateCents: 200, budgetCents: 10_000, minViews: 1000, maxClipCents: null };

  it("is the rate per 1,000 views, from the minimum, up to the most a clip can earn, in whole cents", () => {
    expect(clipEarned(999, terms)).toBe(0);
    expect(clipEarned(1000, terms)).toBe(200);
    expect(clipEarned(12_345, terms)).toBe(2469);
    expect(clipEarned(1_000_000, { ...terms, maxClipCents: 5000 })).toBe(5000);
    expect(clipEarned(0, { ...terms, minViews: 0 })).toBe(0);
    expect(clipEarned(Number.NaN, terms)).toBe(0);
  });

  it("shares the budget in the order clips were approved, and counts what was paid", () => {
    const s = settle(
      terms,
      [
        { id: 2, userId: "b", views: 40_000, approvedAt: 20 },
        { id: 1, userId: "a", views: 30_000, approvedAt: 10 },
        { id: 3, userId: "a", views: 500, approvedAt: 30 },
      ],
      [{ userId: "a", amountCents: 2500 }],
    );
    // a's clip was approved first: $60. b's is worth $80, but $40 is left.
    expect([...s.clips]).toEqual([
      [1, 6000],
      [2, 4000],
      [3, 0],
    ]);
    expect(s.clippers.get("a")).toEqual({ clips: 2, views: 30_500, earnedCents: 6000, paidCents: 2500, owedCents: 3500 });
    expect(s.clippers.get("b")).toMatchObject({ earnedCents: 4000, paidCents: 0, owedCents: 4000 });
    expect(s).toMatchObject({ spentCents: 10_000, leftCents: 0, views: 70_500 });
  });

  it("keeps money paid to people who have left, or paid beyond what was earned, out of what is left", () => {
    const s = settle(terms, [{ id: 1, userId: "a", views: 5000, approvedAt: 1 }], [
      { userId: null, amountCents: 3000 },
      { userId: "a", amountCents: 1500 },
      { userId: "gone-quiet", amountCents: 700 },
    ]);
    expect(s.clippers.get("a")).toMatchObject({ earnedCents: 1000, paidCents: 1500, owedCents: 0 });
    expect(s.spentCents).toBe(3000 + 1500 + 700);
    expect(s.leftCents).toBe(10_000 - 5200);
  });

  it("writes large numbers short", () => {
    expect(compactNumber(9_999)).toBe("9,999");
    expect(compactNumber(37_200_000)).toBe("37.2M");
    expect(compactNumber(12_340)).toBe("12.3K");
  });
});

describe("what a campaign and a clipper may say", () => {
  it("tidies a campaign's words, keeps rules one per line, and puts platforms in a fixed order", () => {
    const c = input({ platforms: ["x", "tiktok"] });
    expect(c.rules).toBe("Post it on your own channel\nTag @testcreator");
    expect(c.platforms).toEqual(["tiktok", "x"]);
    expect(campaignInputSchema.safeParse({ ...c, platforms: [] }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...c, rateCents: 0 }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...c, budgetCents: 12.5 }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...c, sourceUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...c, sourceUrl: "http://example.com/video" }).success).toBe(false);
    expect(campaignInputSchema.safeParse({ ...c, sourceUrl: "" }).success).toBe(true);
    expect(campaignInputSchema.safeParse({ ...c, title: "abc" }).success).toBe(false);
  });

  it("makes an address from a title, and cents from an amount", () => {
    expect(slugify("Ninja: Fortnite clips!")).toBe("ninja-fortnite-clips");
    expect(slugify("  Café   Olé ")).toBe("cafe-ole");
    expect(slugify("日本語")).toBe("campaign");
    expect(parseDollars("2.50")).toBe(250);
    expect(parseDollars("$1,000")).toBe(100_000);
    expect(parseDollars("0.07")).toBe(7);
    for (const bad of ["", "abc", "1.234", "-5", "1e3", "2,5.0.1"]) expect(parseDollars(bad), bad).toBeNull();
  });

  it("asks a clipper for a name and a channel", () => {
    expect(clipperInputSchema.parse({ name: "  Mira \n Clips ", link: " tiktok.com/@mira ", payout: "PayPal:\tmira@example.com" })).toEqual({ name: "Mira Clips", link: "tiktok.com/@mira", payout: "PayPal: mira@example.com" });
    expect(clipperInputSchema.safeParse({ name: "M", link: "tiktok.com/@mira", payout: "" }).success).toBe(false);
    expect(clipperInputSchema.safeParse({ name: "Mira", link: "", payout: "" }).success).toBe(false);
    expect(clipperInputSchema.safeParse({ name: "Mira", link: "https://example.com/me", payout: "" }).success).toBe(false);
  });
});

describe("a campaign", () => {
  beforeEach(async () => {
    process.env.BAMIO_EMAIL = "preview";
    await clean();
  });
  afterAll(async () => {
    await clean();
    delete process.env.BAMIO_EMAIL;
  });

  it("is a draft only admins see until it goes live, at an address made from its title", async () => {
    const first = await createCampaign(boss, input());
    expect(first.slug).toBe("unit-test-campaign");
    // The same title again: another address.
    expect((await createCampaign(boss, input())).slug).toBe("unit-test-campaign-2");

    expect((await listCampaigns()).filter((c) => c.title === TITLE)).toEqual([]);
    expect(await campaignBySlug(first.slug)).toBeNull();
    expect((await campaignBySlug(first.slug, { drafts: true }))?.campaign).toMatchObject({ status: "draft", rules: ["Post it on your own channel", "Tag @testcreator"], platforms: ["tiktok", "youtube"] });
    await expect(joinCampaign(MIRA, first.slug, mira, null)).rejects.toMatchObject({ status: 404 });
    await expect(setCampaignStatus(boss, first.id, "paused")).rejects.toMatchObject({ status: 409 });

    await setCampaignStatus(boss, first.id, "live");
    const listed = (await listCampaigns()).find((c) => c.slug === first.slug);
    expect(listed).toMatchObject({ status: "live", rateCents: 200, budgetCents: 10_000, stats: { spentCents: 0, clippers: 0, clips: 0, views: 0 } });
    // A draft can be deleted; a campaign people have seen can't.
    await deleteCampaign(boss, (await adminCampaigns()).find((c) => c.slug === "unit-test-campaign-2")!.id);
    await expect(deleteCampaign(boss, first.id)).rejects.toMatchObject({ status: 409 });
    expect((await adminCampaigns()).filter((c) => c.title === TITLE).map((c) => c.slug)).toEqual([first.slug]);
  });

  it("takes clips only from its members, on its platforms, once each", async () => {
    const { id, slug } = await createCampaign(boss, input());
    await setCampaignStatus(boss, id, "live");
    await expect(submitClip(MIRA, slug, TIKTOK(1))).rejects.toMatchObject({ status: 403, code: "not_joined" });

    expect(await myClipper(MIRA)).toBeNull();
    await joinCampaign(MIRA, slug, mira, "https://img.clerk.com/mira");
    await joinCampaign(MIRA, slug, mira, "https://img.clerk.com/mira");
    expect(await myClipper(MIRA)).toEqual({ name: "Mira Clips", link: "https://tiktok.com/@mira.clips", payout: "PayPal: mira@example.com", imageUrl: "https://img.clerk.com/mira", blocked: false });
    expect(await myCampaign(MIRA, slug)).toMatchObject({ joined: true, clips: [], earnedCents: 0, owedCents: 0 });
    expect(await myCampaign(OTTO, slug)).toMatchObject({ joined: false, clipper: null });

    await submitClip(MIRA, slug, `${TIKTOK(1)}?lang=en`);
    await expect(submitClip(MIRA, slug, `m.tiktok.com/@mira.clips/video/73000000000000000${1}`)).rejects.toMatchObject({ status: 409, code: "duplicate" });
    await expect(submitClip(MIRA, slug, "https://example.com/clip")).rejects.toMatchObject({ status: 400, code: "bad_link" });
    await expect(submitClip(MIRA, slug, "https://www.instagram.com/reel/C8abcDEF_-1/")).rejects.toMatchObject({ status: 400, code: "wrong_platform" });
    // A share link is followed first; one that leads nowhere is refused.
    await submitClip(MIRA, slug, "https://vm.tiktok.com/ZMabc123/", async () => clipLink(TIKTOK(2)));
    await expect(submitClip(MIRA, slug, "https://vm.tiktok.com/ZMabc999/", async () => null)).rejects.toMatchObject({ status: 400, code: "short_link" });
    await expect(submitClip(MIRA, slug, "https://vm.tiktok.com/ZMabc123/", async () => clipLink(TIKTOK(2)))).rejects.toMatchObject({ code: "duplicate" });

    const mine = await myCampaign(MIRA, slug);
    expect(mine.clips.map((c) => [c.url, c.status, c.views, c.byHand])).toEqual([
      [TIKTOK(2), "pending", null, false],
      [TIKTOK(1), "pending", null, false],
    ]);
    // Waiting clips don't count, and can be taken back.
    expect((await campaignBySlug(slug))?.campaign.stats).toEqual({ spentCents: 0, clippers: 1, clips: 0, views: 0 });
    expect(await campaignCounts()).toMatchObject({ waiting: expect.any(Number) });
    await expect(withdrawClip(OTTO, mine.clips[0]!.id)).rejects.toMatchObject({ status: 404 });
    await withdrawClip(MIRA, mine.clips[0]!.id);
    expect((await myCampaign(MIRA, slug)).clips).toHaveLength(1);

    // Paused: shown, but nothing new comes in.
    await setCampaignStatus(boss, id, "paused");
    await expect(submitClip(MIRA, slug, TIKTOK(3))).rejects.toMatchObject({ status: 409, code: "closed" });
    await expect(joinCampaign(OTTO, slug, otto, null)).rejects.toMatchObject({ status: 409, code: "closed" });
  });

  it("counts approved clips' views, pays in the order they were approved, and ends when the budget is used", async () => {
    const { id, slug } = await createCampaign(boss, input());
    await setCampaignStatus(boss, id, "live");
    await joinCampaign(MIRA, slug, mira, null);
    await joinCampaign(OTTO, slug, otto, null);
    await submitClip(MIRA, slug, TIKTOK(1), undefined, 1000);
    await submitClip(OTTO, slug, "https://youtube.com/shorts/jNQXAC9IVRw", undefined, 2000);
    const [miraClip, ottoClip] = (await clipIds(id)) as [number, number];

    // Bamio reads each clip's views: the one that has waited longest first.
    const seen: string[] = [];
    const lookup = async (url: string) => {
      seen.push(url);
      if (url.includes("tiktok")) return { views: 30_000, title: "Clutch", author: "mira.clips" };
      throw new Error("ERROR: [youtube] jNQXAC9IVRw: Video unavailable");
    };
    const t0 = Date.now();
    expect(await countNextViews(lookup, t0)).toBe(true);
    expect(await countNextViews(lookup, t0)).toBe(true);
    expect(await countNextViews(lookup, t0)).toBe(false);
    expect(seen).toEqual([TIKTOK(1), "https://www.youtube.com/shorts/jNQXAC9IVRw"]);
    let admin = (await adminCampaign(id))!;
    expect(admin.clips.map((c) => [c.name, c.status, c.counted, c.error, c.author])).toEqual([
      ["Otto", "pending", null, "[youtube] jNQXAC9IVRw: Video unavailable", null],
      ["Mira Clips", "pending", 30_000, null, "mira.clips"],
    ]);
    // Counted again only when due (six hours by default), or when an admin asks.
    expect(await countNextViews(lookup, t0 + 3600_000)).toBe(false);
    await recountClip(miraClip);
    expect(await countNextViews(async () => ({ views: 31_000, title: null, author: null }), t0 + 3600_000)).toBe(true);
    expect((await myCampaign(MIRA, slug)).clips[0]).toMatchObject({ views: 31_000, earnedCents: 0, status: "pending" });
    // The site wouldn't say: the clipper is told a person adds the views.
    expect((await myCampaign(OTTO, slug)).clips[0]).toMatchObject({ views: null, byHand: true });

    // Approved: Mira's 31,000 views at $2 per 1,000.
    await reviewClip(boss, miraClip, "approve", "", 5000);
    expect(await myCampaign(MIRA, slug)).toMatchObject({ earnedCents: 6200, paidCents: 0, owedCents: 6200 });
    expect((await campaignBySlug(slug))?.leaders).toEqual([
      { name: "Mira Clips", imageUrl: null, link: { url: "https://tiktok.com/@mira.clips", platform: "tiktok", handle: "mira.clips" }, clips: 1, views: 31_000, earnedCents: 6200 },
    ]);

    // Rejected with a reason, which its clipper sees; then approved after all, with views typed in.
    await reviewClip(boss, ottoClip, "reject", "The video is private.");
    expect((await myCampaign(OTTO, slug)).clips[0]).toMatchObject({ status: "rejected", note: "The video is private." });
    await reviewClip(boss, ottoClip, "approve", "", 6000);
    await setClipViews(boss, ottoClip, 10_000);
    expect(await myCampaign(OTTO, slug)).toMatchObject({ earnedCents: 2000, clips: [{ status: "approved", note: null, views: 10_000 }] });
    expect((await campaignBySlug(slug))?.campaign).toMatchObject({ status: "live", stats: { spentCents: 8200, clippers: 2, clips: 2, views: 41_000 } });

    // Otto's clip takes off: it would earn $100, but $38 of the budget is left. The campaign ends.
    await setClipViews(boss, ottoClip, 50_000);
    const page = (await campaignBySlug(slug))!;
    expect(page.campaign).toMatchObject({ status: "ended", stats: { spentCents: 10_000 } });
    expect(page.leaders.map((l) => [l.name, l.earnedCents])).toEqual([
      ["Mira Clips", 6200],
      ["Otto", 3800],
    ]);
    // Ended: counts are frozen, nothing new comes in, and it can't reopen without more budget.
    expect(await countNextViews(lookup, t0 + 24 * 3600_000)).toBe(false);
    await expect(submitClip(MIRA, slug, TIKTOK(4))).rejects.toMatchObject({ status: 409, code: "closed" });
    await expect(setCampaignStatus(boss, id, "live")).rejects.toMatchObject({ status: 409, code: "spent" });
    await updateCampaign(boss, id, input({ budgetCents: 50_000 }));
    await setCampaignStatus(boss, id, "live");
    expect(await myCampaign(OTTO, slug)).toMatchObject({ earnedCents: 10_000 });

    admin = (await adminCampaign(id))!;
    expect(admin).toMatchObject({ spentCents: 16_200, leftCents: 33_800, views: 81_000 });
    expect(admin.clippers.map((c) => [c.name, c.payout, c.clips, c.earnedCents, c.owedCents])).toEqual([
      ["Otto", "", 1, 10_000, 10_000],
      ["Mira Clips", "PayPal: mira@example.com", 1, 6200, 6200],
    ]);
  });

  it("records what was paid outside Bamio, never more than is owed, and tells the clipper", async () => {
    const { id, slug } = await createCampaign(boss, input());
    await setCampaignStatus(boss, id, "live");
    await joinCampaign(MIRA, slug, mira, null);
    await submitClip(MIRA, slug, TIKTOK(1));
    const [clip] = (await clipIds(id)) as [number];
    await reviewClip(boss, clip, "approve");
    await setClipViews(boss, clip, 20_000);

    await expect(recordPayout(boss, id, MIRA, 4001, "")).rejects.toMatchObject({ status: 409, code: "too_much", message: "They’re owed $40. Record that much or less." });
    await expect(recordPayout(boss, id, OTTO, 100, "")).rejects.toMatchObject({ status: 409, code: "too_much" });
    await recordPayout(boss, id, MIRA, 2500, "PayPal, Friday");
    expect(await myCampaign(MIRA, slug)).toMatchObject({ earnedCents: 4000, paidCents: 2500, owedCents: 1500 });
    await recordPayout(boss, id, MIRA, 1500, "");
    await expect(recordPayout(boss, id, MIRA, 1, "")).rejects.toMatchObject({ code: "too_much", message: "Nothing is owed to this clipper right now." });
    expect((await myCampaigns(MIRA)).find((c) => c.slug === slug)).toEqual({ slug, title: TITLE, brand: "Test Creator", status: "live", clips: 1, waiting: 0, earnedCents: 4000, owedCents: 0 });

    const admin = (await adminCampaign(id))!;
    expect(admin.payouts.map((p) => [p.name, p.amountCents, p.note, p.paidBy])).toEqual([
      ["Mira Clips", 1500, "", "boss@example.com"],
      ["Mira Clips", 2500, "PayPal, Friday", "boss@example.com"],
    ]);
    const emails = await db()<{ template: string; data: { amountCents: number; slug: string } }[]>`select template, data from emails where user_id = ${MIRA} order by id`;
    expect(emails.map((e) => [e.template, e.data.amountCents, e.data.slug])).toEqual([
      ["campaign-paid", 2500, slug],
      ["campaign-paid", 1500, slug],
    ]);
    const log = await db()<{ action: string }[]>`select action from admin_actions where admin_user_id = ${boss.userId} order by id`;
    expect(log.map((l) => l.action)).toEqual(["campaign.create", "campaign.live", "campaign.clip.approve", "campaign.clip.views", "campaign.payout", "campaign.payout"]);
  });

  it("leaves a blocked clipper out of everything", async () => {
    const { id, slug } = await createCampaign(boss, input());
    await setCampaignStatus(boss, id, "live");
    await joinCampaign(MIRA, slug, mira, null);
    await submitClip(MIRA, slug, TIKTOK(1));
    const [clip] = (await clipIds(id)) as [number];
    await reviewClip(boss, clip, "approve");
    await setClipViews(boss, clip, 20_000);
    expect((await campaignBySlug(slug))?.leaders).toHaveLength(1);

    await blockClipper(boss, MIRA, true);
    const page = (await campaignBySlug(slug))!;
    expect(page.leaders).toEqual([]);
    expect(page.campaign.stats).toEqual({ spentCents: 0, clippers: 0, clips: 0, views: 0 });
    expect(await myCampaign(MIRA, slug)).toMatchObject({ clipper: { blocked: true }, earnedCents: 0 });
    await expect(submitClip(MIRA, slug, TIKTOK(2))).rejects.toMatchObject({ status: 403, code: "blocked" });
    await expect(recordPayout(boss, id, MIRA, 100, "")).rejects.toMatchObject({ code: "too_much" });
    expect((await adminCampaign(id))!.clippers[0]).toMatchObject({ name: "Mira Clips", blocked: true, earnedCents: 0 });

    await blockClipper(boss, MIRA, false);
    expect((await campaignBySlug(slug))?.leaders).toHaveLength(1);
    await expect(blockClipper(boss, OTTO, true)).rejects.toMatchObject({ status: 404 });
  });

  it("ends on its last day", async () => {
    const { id, slug } = await createCampaign(boss, input({ endsAt: 10_000 }));
    await expect(setCampaignStatus(boss, id, "live", 20_000)).rejects.toMatchObject({ status: 409, code: "over" });
    await setCampaignStatus(boss, id, "live", 5000);
    expect(await endDueCampaigns(9_999)).toBe(0);
    expect(await endDueCampaigns(10_000)).toBe(1);
    expect((await campaignBySlug(slug))?.campaign.status).toBe("ended");
  });
});

describe("asking to run a campaign", () => {
  beforeEach(async () => {
    process.env.BAMIO_EMAIL = "preview";
    await clean();
  });
  afterAll(async () => {
    await clean();
    delete process.env.BAMIO_EMAIL;
  });

  const ask = (over: Partial<Record<keyof CampaignRequestInput, unknown>> = {}): CampaignRequestInput =>
    campaignRequestSchema.parse({
      kind: "podcaster",
      name: "The Test Show",
      sourceUrl: "youtube.com/@thetestshow",
      brief: "The funniest or most surprising minute of each episode.",
      platforms: ["youtube", "tiktok"],
      rateCents: 150,
      budgetCents: 50_000,
      payout: "PayPal, every Friday.",
      contact: "",
      ...over,
    });

  it("takes what a podcaster, streamer or business says about it, tidied", () => {
    expect(ask()).toMatchObject({ kind: "podcaster", sourceUrl: "https://youtube.com/@thetestshow", platforms: ["tiktok", "youtube"], rateCents: 150 });
    const base = { ...ask(), sourceUrl: "https://youtube.com/@thetestshow" };
    for (const bad of [{ kind: "agency" }, { name: "T" }, { sourceUrl: "" }, { sourceUrl: "javascript:alert(1)" }, { brief: "Clips." }, { platforms: [] }, { rateCents: 0 }, { budgetCents: 1.5 }, { payout: "" }]) {
      expect(campaignRequestSchema.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it("waits for an admin, who makes the campaign from it; the person who asked hears when it's live", async () => {
    const id = await requestCampaign(MIRA, ask(), "mira@example.com", 1000);
    expect(await myCampaignRequests(MIRA)).toEqual([{ id, name: "The Test Show", kind: "podcaster", rateCents: 150, budgetCents: 50_000, status: "pending", note: null, campaign: null, createdAt: 1000 }]);
    expect(await myCampaignRequests(OTTO)).toEqual([]);
    expect(await waitingRequests()).toBeGreaterThanOrEqual(1);
    const listed = (await adminCampaignRequests()).find((r) => r.id === id)!;
    expect(listed).toMatchObject({ userId: MIRA, email: "mira@example.com", kind: "podcaster", sourceUrl: "https://youtube.com/@thetestshow", payout: "PayPal, every Friday.", status: "pending", campaign: null });

    // The admin writes the campaign (starting from the request): a draft, tied to it.
    const made = await createCampaignFromRequest(boss, id, input({ brand: "The Test Show", rateCents: 150, budgetCents: 50_000 }), 2000);
    expect((await myCampaignRequests(MIRA))[0]).toMatchObject({ status: "accepted", campaign: { slug: made.slug, status: "draft" } });
    expect(await requestOfCampaign(made.id)).toMatchObject({ id, userId: MIRA, email: "mira@example.com" });
    expect(await campaignBySlug(made.slug)).toBeNull();
    // Answered once: not again, and not taken back.
    await expect(createCampaignFromRequest(boss, id, input())).rejects.toMatchObject({ status: 409, code: "answered" });
    await expect(declineCampaignRequest(boss, id, "No.")).rejects.toMatchObject({ status: 409 });
    await expect(withdrawCampaignRequest(MIRA, id)).rejects.toMatchObject({ status: 409 });
    const emailed = async () => (await db()<{ template: string }[]>`select template from emails where user_id = ${MIRA} order by id`).map((e) => e.template);
    expect(await emailed()).toEqual([]);

    // Live: they're emailed, once, however often it's paused and reopened.
    await setCampaignStatus(boss, made.id, "live");
    await setCampaignStatus(boss, made.id, "paused");
    await setCampaignStatus(boss, made.id, "live");
    expect(await emailed()).toEqual(["campaign-live"]);
    expect((await myCampaignRequests(MIRA))[0]!.campaign).toEqual({ slug: made.slug, status: "live" });
    // A campaign an admin made from scratch has nobody to tell.
    const own = await createCampaign(boss, input());
    await setCampaignStatus(boss, own.id, "live");
    expect(await requestOfCampaign(own.id)).toBeNull();
    const log = await db()<{ action: string }[]>`select action from admin_actions where admin_user_id = ${boss.userId} and action like 'campaign.request.%'`;
    expect(log.map((l) => l.action)).toEqual(["campaign.request.accept"]);
  });

  it("can be declined with a word why, or taken back, and only a few wait at once", async () => {
    const first = await requestCampaign(OTTO, ask({ kind: "business", name: "Otto's Bikes" }), null);
    await declineCampaignRequest(boss, first, "The link is to someone else's channel.");
    expect((await myCampaignRequests(OTTO))[0]).toMatchObject({ status: "declined", note: "The link is to someone else's channel.", campaign: null });
    const emails = await db()<{ template: string; data: { name: string; note: string } }[]>`select template, data from emails where user_id = ${OTTO}`;
    expect(emails.map((e) => [e.template, e.data.name, e.data.note])).toEqual([["campaign-declined", "Otto's Bikes", "The link is to someone else's channel."]]);
    await expect(createCampaignFromRequest(boss, first, input())).rejects.toMatchObject({ status: 409 });

    // A declined one doesn't count against the next: three may wait, the fourth is refused.
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await requestCampaign(OTTO, ask({ name: `Otto ${i}` }), null));
    await expect(requestCampaign(OTTO, ask(), null)).rejects.toMatchObject({ status: 409, code: "too_many" });
    // Taken back by its owner only, while it waits.
    await expect(withdrawCampaignRequest(MIRA, ids[0]!)).rejects.toMatchObject({ status: 404 });
    await withdrawCampaignRequest(OTTO, ids[0]!);
    expect((await myCampaignRequests(OTTO)).map((r) => [r.name, r.status])).toEqual([
      ["Otto 2", "pending"],
      ["Otto 1", "pending"],
      ["Otto's Bikes", "declined"],
    ]);
    await expect(requestCampaign(OTTO, ask(), null)).resolves.toBeGreaterThan(0);
    // Admins see those waiting first, the oldest at the top.
    const mine = (await adminCampaignRequests()).filter((r) => r.userId === OTTO).map((r) => r.name);
    expect(mine).toEqual(["Otto 1", "Otto 2", "The Test Show", "Otto's Bikes"]);
  });
});

describe("who may see campaigns", () => {
  const ADA = "user_camp_ada";
  const tidy = async () => {
    const sql = db();
    for (const u of [MIRA, OTTO, ADA]) {
      await sql`delete from billing_accounts where user_id = ${u}`;
      await sql`delete from plan_grants where user_id = ${u}`;
      await sql`delete from admins where user_id = ${u}`;
    }
    delete process.env.STRIPE_SECRET_KEY;
    await clean();
  };
  beforeEach(tidy);
  afterAll(tidy);

  /** A subscription as Stripe's webhooks would have saved it (read just now, so nothing asks Stripe). */
  const subscribe = async (userId: string, status: string) => {
    const now = Date.now();
    const subscription = { id: `sub_${userId}`, status, plan: "starter", interval: "month", anchor: now - 86400_000, periodEnd: now + 29 * 86400_000, cancelAt: null, checkedAt: now };
    await db()`insert into billing_accounts (user_id, data, updated_at) values (${userId}, ${db().json({ customerId: `cus_${userId}`, subscription })}, ${now})
      on conflict (user_id) do update set data = excluded.data`;
  };

  it("is everyone while plans are off", async () => {
    expect(await campaignAccess(null)).toBe("open");
    expect(await campaignAccess(MIRA)).toBe("open");
    await expect(assertCampaignAccess(MIRA)).resolves.toBeUndefined();
  });

  it("is only accounts with a plan once plans are on: not visitors, not the free trial, not a plan that has ended", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    expect(await campaignAccess(null)).toBe("signed_out");
    expect(canSeeCampaigns("signed_out")).toBe(false);
    // A new account has its free video, which isn't a plan.
    expect(await campaignAccess(MIRA)).toBe("no_plan");
    await expect(assertCampaignAccess(MIRA)).rejects.toMatchObject({ status: 402, code: "plan_required" });

    await subscribe(OTTO, "active");
    expect(await campaignAccess(OTTO)).toBe("open");
    await expect(assertCampaignAccess(OTTO)).resolves.toBeUndefined();
    await subscribe(OTTO, "canceled");
    expect(await campaignAccess(OTTO)).toBe("no_plan");

    // A plan given without paying is a plan.
    await db()`insert into plan_grants (user_id, plan, note, created_at) values (${MIRA}, 'pro', 'test', ${Date.now()})`;
    expect(await campaignAccess(MIRA)).toBe("open");
  });

  it("lets admins in, and the person who asked for a campaign into that one", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    // An admin runs the campaigns, plan or no plan.
    await db()`insert into admins (user_id, email, added_by, created_at) values (${ADA}, 'ada@example.com', 'test', ${Date.now()})`;
    expect(await campaignAccess(ADA)).toBe("open");

    // Mira asked for a campaign and has no plan: she may open hers, not the others, and can't clip in any.
    const asked = await requestCampaign(MIRA, campaignRequestSchema.parse({ kind: "podcaster", name: "The Test Show", sourceUrl: "youtube.com/@thetestshow", brief: "The funniest minute of each episode.", platforms: ["tiktok"], rateCents: 100, budgetCents: 10_000, payout: "PayPal, monthly", contact: "" }), null);
    const hers = await createCampaignFromRequest(boss, asked, input());
    const other = await createCampaign(boss, input());
    expect(await campaignAccess(MIRA, hers.id)).toBe("owner");
    expect(canSeeCampaigns("owner")).toBe(true);
    expect(await campaignAccess(MIRA, other.id)).toBe("no_plan");
    expect(await campaignAccess(MIRA)).toBe("no_plan");
    expect(await campaignAccess(OTTO, hers.id)).toBe("no_plan");
    await expect(assertCampaignAccess(MIRA)).rejects.toMatchObject({ status: 402 });
    // The page asks by address: what it needs to decide, without the campaign's sums.
    expect(await campaignRef(hers.slug)).toEqual({ id: hers.id, status: "draft" });
    expect(await campaignRef("no-such-campaign")).toBeNull();
    expect(await campaignRef("../etc")).toBeNull();
    await setCampaignStatus(boss, hers.id, "live");
    expect(await openCampaignCount()).toBeGreaterThanOrEqual(1);
  });
});
