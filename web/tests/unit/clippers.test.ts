import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clipperInputSchema, clipperLink } from "@/lib/profile/clipper";
import type { Admin } from "@/lib/server/admin";
import { clipperCounts, clipperQueue, listClippers, myClipper, removeClipper, reviewClipper, saveClipper } from "@/lib/server/clippers";
import { db } from "@/lib/server/db";
import { blankProject, createProject } from "@/lib/server/store";

/* The Clippers page: what a card may say, and that only approved cards are public. */

// The admin module (the log of changes) loads Clerk: not needed here.
vi.mock("@clerk/nextjs/server", () => ({ auth: async () => ({ userId: null }), clerkClient: async () => ({ users: {} }) }));

const MIRA = "user_clip_mira";
const OTTO = "user_clip_otto";
const boss: Admin = { userId: "user_clip_boss", email: "boss@example.com", role: "superadmin" };

async function clean() {
  const sql = db();
  for (const u of [MIRA, OTTO]) {
    await sql`delete from clipper_profiles where user_id = ${u}`;
    await sql`delete from projects where user_id = ${u}`;
    await sql`delete from emails where user_id = ${u}`;
  }
  await sql`delete from admin_actions where admin_user_id = ${boss.userId}`;
}

/** A project with `done` exported clips and one that isn't exported. */
async function projectWithClips(userId: string, done: number) {
  const p = blankProject({ title: "P", source: { kind: "upload", platform: "upload", title: "P", durationSec: 60 }, findClips: false, clipLength: "short", job: { status: "ready", message: "Ready" } });
  await createProject(userId, p);
  const clips = [...Array.from({ length: done }, () => ({ export: { status: "done" } })), { export: { status: "queued" } }, {}];
  await db()`update projects set data = jsonb_set(data, '{clips}', ${db().json(clips)}) where id = ${p.id}`;
}

describe("a clipper's channel link", () => {
  it("is a channel on a platform Bamio knows, tidied", () => {
    expect(clipperLink("twitch.tv/mira_clips")).toEqual({ url: "https://twitch.tv/mira_clips", platform: "twitch", handle: "mira_clips" });
    expect(clipperLink(" https://www.youtube.com/@MiraClips/?sub=1#x ")).toEqual({ url: "https://youtube.com/@MiraClips", platform: "youtube", handle: "MiraClips" });
    expect(clipperLink("https://twitter.com/mira")).toMatchObject({ url: "https://x.com/mira", platform: "x" });
    expect(clipperLink("m.tiktok.com/@mira.clips")).toMatchObject({ platform: "tiktok", handle: "mira.clips" });
    expect(clipperLink("https://kick.com/mira")?.platform).toBe("kick");
    expect(clipperLink("instagram.com/mira/")?.url).toBe("https://instagram.com/mira");
  });

  it("is refused anywhere else, or when it isn't a channel", () => {
    for (const bad of ["", "https://example.com/mira", "https://twitch.tv", "https://twitch.tv/", "javascript:alert(1)", "https://evil.com/twitch.tv/mira", "https://twitch.tv.evil.com/mira", "https://user:pw@twitch.tv/mira", "https://twitch.tv/mi ra", "https://twitch.tv/%zz", "https://twitch.tv/<script>"]) {
      expect(clipperLink(bad), bad).toBeNull();
    }
  });
});

describe("what a card may say", () => {
  it("is a short name, one line and a channel, with odd spacing taken out", () => {
    const ok = clipperInputSchema.parse({ name: "  Mira \n Clips ", bio: "I clip\tFPS   streams.", link: " twitch.tv/mira " });
    expect(ok).toEqual({ name: "Mira Clips", bio: "I clip FPS streams.", link: "twitch.tv/mira" });
    expect(clipperInputSchema.safeParse({ name: "M", bio: "", link: "" }).success).toBe(false);
    expect(clipperInputSchema.safeParse({ name: "Mira", bio: "x".repeat(141), link: "" }).success).toBe(false);
    expect(clipperInputSchema.safeParse({ name: "Mira", bio: "", link: "https://example.com/me" }).success).toBe(false);
    expect(clipperInputSchema.safeParse({ name: "Mira", bio: "", link: "" }).success).toBe(true);
  });
});

describe("the Clippers page", () => {
  beforeEach(async () => {
    process.env.BAMIO_EMAIL = "preview";
    await clean();
  });
  afterAll(async () => {
    await clean();
    delete process.env.BAMIO_EMAIL;
  });

  it("shows a card only once an admin approves it, with the clips its owner exported", async () => {
    await projectWithClips(MIRA, 3);
    await projectWithClips(MIRA, 2);
    expect(await myClipper(MIRA)).toBeNull();
    const saved = await saveClipper(MIRA, { name: "Mira Clips", bio: "I clip FPS streams.", link: "twitch.tv/mira" }, "https://img.clerk.com/mira");
    expect(saved).toEqual({ name: "Mira Clips", bio: "I clip FPS streams.", link: "https://twitch.tv/mira", status: "pending", imageUrl: "https://img.clerk.com/mira" });
    expect(await listClippers()).toEqual([]);
    expect(await clipperCounts()).toMatchObject({ pending: 1, approved: 0 });

    await reviewClipper(boss, MIRA, "approve");
    expect(await listClippers()).toEqual([
      { name: "Mira Clips", bio: "I clip FPS streams.", link: { url: "https://twitch.tv/mira", platform: "twitch", handle: "mira" }, imageUrl: "https://img.clerk.com/mira", clips: 5 },
    ]);
    expect((await myClipper(MIRA))?.status).toBe("approved");
    // Its owner hears once per approval; approving again doesn't email again.
    await reviewClipper(boss, MIRA, "approve");
    const emails = await db()<{ template: string }[]>`select template from emails where user_id = ${MIRA}`;
    expect(emails.map((e) => e.template)).toEqual(["clipper-approved"]);
    const log = await db()<{ action: string; target: string }[]>`select action, target from admin_actions where admin_user_id = ${boss.userId} order by id`;
    expect(log.map((l) => [l.action, l.target])).toEqual([
      ["clipper.approve", MIRA],
      ["clipper.approve", MIRA],
    ]);
  });

  it("sends a changed card back for a look, keeps an unchanged one, and lists the most clips first", async () => {
    await projectWithClips(OTTO, 1);
    await projectWithClips(MIRA, 4);
    await saveClipper(OTTO, { name: "Otto", bio: "", link: "" }, null);
    await saveClipper(MIRA, { name: "Mira", bio: "Podcasts.", link: "" }, null);
    await reviewClipper(boss, OTTO, "approve");
    await reviewClipper(boss, MIRA, "approve");
    expect((await listClippers()).map((c) => [c.name, c.clips, c.link])).toEqual([
      ["Mira", 4, null],
      ["Otto", 1, null],
    ]);

    // The same card again (a new picture): still approved.
    expect((await saveClipper(MIRA, { name: "Mira", bio: "Podcasts.", link: "" }, "https://img.clerk.com/new")).status).toBe("approved");
    expect((await listClippers())[0]?.imageUrl).toBe("https://img.clerk.com/new");
    // Different words: off the page until someone has seen them.
    expect((await saveClipper(MIRA, { name: "Mira", bio: "Buy followers at example dot com", link: "" }, null)).status).toBe("pending");
    expect((await listClippers()).map((c) => c.name)).toEqual(["Otto"]);
    expect((await clipperQueue()).map((c) => [c.name, c.status])).toEqual([
      ["Mira", "pending"],
      ["Otto", "approved"],
    ]);

    // Hidden by an admin; changed and sent again by its owner.
    await reviewClipper(boss, MIRA, "hide");
    expect((await myClipper(MIRA))?.status).toBe("hidden");
    expect((await saveClipper(MIRA, { name: "Mira", bio: "Podcasts, mostly.", link: "" }, null)).status).toBe("pending");

    // Turned off: gone, and nothing left to approve.
    await removeClipper(OTTO);
    expect(await myClipper(OTTO)).toBeNull();
    expect(await listClippers()).toEqual([]);
    await expect(reviewClipper(boss, OTTO, "approve")).rejects.toMatchObject({ status: 404 });
  });
});
