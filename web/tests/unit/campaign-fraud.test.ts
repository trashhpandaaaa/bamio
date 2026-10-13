import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clipFlags, clipperFlags, JUMP, logViews, payoutKey, VIEW_LOG_SIZE, viewJump } from "@/lib/campaigns/flags";
import { countryCode, countryName, outsideAudience, regionOf } from "@/lib/campaigns/regions";
import { campaignInputSchema, type CampaignInput } from "@/lib/campaigns/schema";
import type { Admin } from "@/lib/server/admin";
import { adminCampaign, createCampaign, joinCampaign, myCampaign, reviewClip, reviewProof, saveProof, setCampaignStatus, submitClip } from "@/lib/server/campaigns";
import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";

/* Checks against fraud in campaigns: where an audience should be, the flags admins see, and audience proof. */

vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }), clerkClient: async () => ({ users: {} }) }));

describe("regions", () => {
  it("reads a country from a code or an English name", () => {
    expect(countryCode("de")).toBe("DE");
    expect(countryCode("Germany")).toBe("DE");
    expect(countryCode("United Kingdom")).toBe("GB");
    expect(countryCode("Atlantis")).toBeNull();
    expect(countryCode(undefined)).toBeNull();
    expect(countryName("NP")).toBe("Nepal");
  });

  it("places countries in regions, and flags only a known country outside a set region", () => {
    expect(regionOf("FR")).toBe("europe");
    expect(regionOf("IN")).toBe("asia");
    expect(regionOf("TR")).toBe("asia");
    expect(regionOf("MX")).toBe("latin_america");
    expect(outsideAudience("IN", "europe")).toBe(true);
    expect(outsideAudience("FR", "europe")).toBe(false);
    expect(outsideAudience("IN", "worldwide")).toBe(false);
    expect(outsideAudience(null, "europe")).toBe(false);
    expect(outsideAudience("ZZ", "europe")).toBe(false);
  });
});

describe("flags", () => {
  const facts = { platform: "tiktok", author: "mira.clips", channel: "tiktok.com/@mira.clips", country: "DE", views: 1000, likes: null, viewLog: [] };

  it("say nothing about an ordinary clip", () => {
    expect(clipFlags(facts, "europe")).toEqual([]);
  });

  it("flag a clip sent from outside the audience, posted by someone else, with few likes, or with a sudden jump", () => {
    const hour = 3600_000;
    const flags = clipFlags({ ...facts, country: "IN", author: "@someone.else", views: 200_000, likes: 120, viewLog: [[0, 2000], [6 * hour, 200_000]] }, "europe");
    expect(flags.map((f) => f.kind)).toEqual(["elsewhere", "not_their_post", "few_likes", "jump"]);
    expect(flags.find((f) => f.kind === "not_their_post")?.text).toBe("Posted by @someone.else, not their channel @mira.clips");
    expect(flags.find((f) => f.kind === "jump")?.text).toBe("Views jumped from 2,000 to 200,000 in 6 h");
  });

  it("don't compare a YouTube channel linked by its id, or posts on another site", () => {
    expect(clipFlags({ ...facts, platform: "youtube", author: "otto", channel: "youtube.com/channel/UCabc" }, "worldwide")).toEqual([]);
    expect(clipFlags({ ...facts, platform: "youtube", author: "otto" }, "worldwide")).toEqual([]);
  });

  it("keep a short log of view counts, and see a jump only when it is big, fast and many times over", () => {
    let log: [number, number][] = [];
    for (let i = 0; i < VIEW_LOG_SIZE + 5; i++) log = logViews(log, i * 1000, i * 10);
    expect(log).toHaveLength(VIEW_LOG_SIZE);
    // The same count again within a day isn't kept twice.
    expect(logViews([[0, 500]], 1000, 500)).toEqual([[0, 500]]);
    expect(viewJump([[0, 10_000], [3600_000, 70_000]])).toBeNull(); // only 7 times
    expect(viewJump([[0, 1000], [JUMP.withinMs + 1, 90_000]])).toBeNull(); // over more than a day
    expect(viewJump([[0, 1000], [3600_000, 60_000]])).toEqual({ from: 1000, to: 60_000, hours: 1 });
  });

  it("flag clippers who share payment details or a channel, joined from elsewhere, or owe proof", () => {
    const base = { country: "FR", proofRequired: false, proofStatus: "none" as const, samePayout: 0, sameChannel: 0 };
    expect(clipperFlags(base, "europe")).toEqual([]);
    expect(clipperFlags({ ...base, country: "PK", samePayout: 2, sameChannel: 1, proofRequired: true }, "europe").map((f) => f.text)).toEqual([
      "Joined from Pakistan",
      "Same payment details as 2 other accounts",
      "Same channel as 1 other account",
      "No audience proof yet",
    ]);
    expect(payoutKey("PayPal: Mira@Example.com ")).toBe(payoutKey("mira@example.com"));
    expect(payoutKey("USDT  TXa bc")).toBe("txabc");
  });
});

const ANA = "user_fraud_ana";
const BEN = "user_fraud_ben";
const boss: Admin = { userId: "user_fraud_boss", email: "boss@example.com", role: "admin" };
const TITLE = "Fraud Test Campaign";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const input = (over: Partial<CampaignInput> = {}): CampaignInput =>
  campaignInputSchema.parse({
    title: TITLE,
    brand: "Bamio",
    summary: "Short videos that show what Bamio does.",
    brief: "Show a long video going in and the clips coming out.",
    rules: "",
    sourceUrl: "",
    platforms: ["tiktok", "youtube"],
    rateCents: 150,
    budgetCents: 100_000,
    minViews: 0,
    maxClipCents: null,
    payout: "After the cycle.",
    endsAt: null,
    audience: "europe",
    audienceProof: true,
    ...over,
  });

async function clean() {
  const sql = db();
  await sql`delete from campaigns where title like ${`${TITLE}%`}`;
  for (const u of [ANA, BEN]) await sql`delete from clippers where user_id = ${u}`;
  await sql`delete from admin_actions where admin_user_id = ${boss.userId}`;
}

describe("audience proof and flags in a campaign", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bamio-fraud-"));
    process.env.BAMIO_DATA_DIR = path.join(dir, "media");
    process.env.BAMIO_WORK_DIR = path.join(dir, "work");
  });
  beforeEach(clean);
  afterAll(async () => {
    await clean();
    delete process.env.BAMIO_DATA_DIR;
    delete process.env.BAMIO_WORK_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  it("keeps clips from counting until the clipper's audience is accepted, and flags what looks wrong", async () => {
    const { id, slug } = await createCampaign(boss, input());
    await setCampaignStatus(boss, id, "live");
    await joinCampaign(ANA, slug, { name: "Ana", link: "tiktok.com/@ana.clips", payout: "PayPal: same@example.com" }, null, 1000, "IN");
    await joinCampaign(BEN, slug, { name: "Ben", link: "tiktok.com/@ben.clips", payout: "same@example.com" }, null, 1000, "DE");
    await submitClip(ANA, slug, "https://www.tiktok.com/@ana.clips/video/7300000000000000001", undefined, 2000, "IN");
    const [clip] = await db()<{ id: number }[]>`select id::int as id from campaign_clips where campaign_id = ${id}`;

    // No proof: the clip waits.
    expect((await myCampaign(ANA, slug)).proof).toEqual({ required: true, status: "none", images: 0, note: null });
    await expect(reviewClip(boss, clip!.id, "approve")).rejects.toMatchObject({ status: 409, code: "proof_needed" });
    await expect(saveProof(ANA, slug, [new Uint8Array([1, 2, 3, 4])])).rejects.toMatchObject({ code: "not_image" });
    await expect(saveProof(ANA, slug, [PNG, PNG, PNG, PNG])).rejects.toMatchObject({ code: "too_many" });

    // Sent, rejected with a reason she sees, sent again, accepted: now the clip can count.
    await saveProof(ANA, slug, [PNG]);
    expect((await myCampaign(ANA, slug)).proof).toMatchObject({ status: "waiting", images: 1 });
    await reviewProof(boss, id, ANA, false, "Mostly India, not Europe.");
    expect((await myCampaign(ANA, slug)).proof).toMatchObject({ status: "rejected", note: "Mostly India, not Europe." });
    await expect(reviewClip(boss, clip!.id, "approve")).rejects.toMatchObject({ code: "proof_needed" });
    await saveProof(ANA, slug, [PNG, PNG]);
    const [member] = await db()<{ proof_keys: string[] }[]>`select proof_keys from campaign_members where campaign_id = ${id} and user_id = ${ANA}`;
    expect(member!.proof_keys).toHaveLength(2);
    for (const key of member!.proof_keys) expect(await storage().stat(key)).not.toBeNull();
    await reviewProof(boss, id, ANA, true);
    await reviewClip(boss, clip!.id, "approve");

    // What admins see: where she joined and sent from, and the payment details she shares with Ben.
    const found = await adminCampaign(id);
    const ana = found!.clippers.find((k) => k.userId === ANA)!;
    expect(ana.country).toBe("IN");
    expect(ana.proof).toMatchObject({ status: "accepted", images: 2, by: "boss@example.com" });
    expect(ana.flags.map((f) => f.kind)).toEqual(["elsewhere", "shared_payout"]);
    expect(found!.clippers.find((k) => k.userId === BEN)!.flags.map((f) => f.kind)).toEqual(["shared_payout", "proof"]);
    expect(found!.clips[0]!.flags.map((f) => f.kind)).toEqual(["elsewhere"]);
  });

  it("asks nothing of clippers in a campaign without proof, wherever they are", async () => {
    const { id, slug } = await createCampaign(boss, input({ audience: "worldwide", audienceProof: false }));
    await setCampaignStatus(boss, id, "live");
    await joinCampaign(BEN, slug, { name: "Ben", link: "tiktok.com/@ben.clips", payout: "" }, null, 1000, "BR");
    await submitClip(BEN, slug, "https://www.tiktok.com/@ben.clips/video/7300000000000000002");
    const [clip] = await db()<{ id: number }[]>`select id::int as id from campaign_clips where campaign_id = ${id}`;
    await reviewClip(boss, clip!.id, "approve");
    expect((await myCampaign(BEN, slug)).proof).toEqual({ required: false, status: "none", images: 0, note: null });
    expect((await adminCampaign(id))!.clippers[0]!.flags).toEqual([]);
  });
});
