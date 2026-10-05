import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { addAdmin, adminActions, adminJobAction, adminOf, forgetAdminRoles, jobById, removeAdmin, setPlanGrant, type Admin } from "@/lib/server/admin";
import { db } from "@/lib/server/db";
import { enqueue } from "@/lib/server/queue";
import { blankProject, createProject, getProject, readPlanGrant } from "@/lib/server/store";

/* The admin panel's roles and changes: who gets in, and what each change leaves behind. */

type Person = { id: string; email: string; verified: boolean };
const people = vi.hoisted(() => new Map<string, { id: string; email: string; verified: boolean }>());

// A fake Clerk: just the users this test makes.
vi.mock("@clerk/nextjs/server", () => {
  const clerkUser = (u: Person) => ({
    id: u.id,
    firstName: null,
    lastName: null,
    username: null,
    imageUrl: "",
    createdAt: 0,
    lastActiveAt: null,
    lastSignInAt: null,
    primaryEmailAddress: { emailAddress: u.email, verification: { status: u.verified ? "verified" : "unverified" } },
    emailAddresses: [{ emailAddress: u.email }],
  });
  return {
    auth: async () => ({ userId: null }),
    clerkClient: async () => ({
      users: {
        getUser: async (id: string) => {
          const u = people.get(id);
          if (!u) throw new Error("Not found");
          return clerkUser(u);
        },
        getUserList: async ({ emailAddress, userId }: { emailAddress?: string[]; userId?: string[] }) => {
          const data = [...people.values()]
            .filter((u) => (!emailAddress || emailAddress.includes(u.email.toLowerCase())) && (!userId || userId.includes(u.id)))
            .map(clerkUser);
          return { data, totalCount: data.length };
        },
      },
    }),
  };
});

const BOSS: Person = { id: "user_adm_boss", email: "Boss@Example.com", verified: true };
const HELPER: Person = { id: "user_adm_helper", email: "helper@example.com", verified: true };
const NOBODY: Person = { id: "user_adm_nobody", email: "nobody@example.com", verified: true };
// Uses a superadmin's address without having proved it's theirs.
const POSER: Person = { id: "user_adm_poser", email: "boss2@example.com", verified: false };
const IDS = [BOSS, HELPER, NOBODY, POSER].map((p) => p.id);

const boss: Admin = { userId: BOSS.id, email: "boss@example.com", role: "superadmin" };
const saved = { supers: process.env.BAMIO_SUPERADMINS, stripe: process.env.STRIPE_SECRET_KEY };

async function clean() {
  await db()`delete from admins where user_id in ${db()(IDS)}`;
  await db()`delete from admin_actions where admin_user_id in ${db()(IDS)}`;
  await db()`delete from plan_grants where user_id in ${db()(IDS)}`;
  await db()`delete from projects where user_id in ${db()(IDS)}`;
}

describe("admin panel", () => {
  beforeEach(async () => {
    for (const p of [BOSS, HELPER, NOBODY, POSER]) people.set(p.id, p);
    process.env.BAMIO_SUPERADMINS = " boss@example.com , BOSS2@example.com";
    delete process.env.STRIPE_SECRET_KEY;
    forgetAdminRoles();
    await clean();
  });

  afterAll(async () => {
    await clean();
    process.env.BAMIO_SUPERADMINS = saved.supers;
    if (saved.stripe) process.env.STRIPE_SECRET_KEY = saved.stripe;
  });

  it("lets in superadmins by verified email, and the admins they add; nobody else", async () => {
    expect(await adminOf(BOSS.id)).toEqual(boss);
    expect(await adminOf(POSER.id)).toBeNull();
    expect(await adminOf(NOBODY.id)).toBeNull();
    expect(await adminOf("user_adm_unknown")).toBeNull();

    await addAdmin(boss, " Helper@Example.com ");
    expect(await adminOf(HELPER.id)).toEqual({ userId: HELPER.id, email: HELPER.email, role: "admin" });
    await expect(addAdmin(boss, "boss@example.com")).rejects.toMatchObject({ status: 409 });
    await expect(addAdmin(boss, "stranger@example.com")).rejects.toMatchObject({ status: 404 });

    await removeAdmin(boss, HELPER.id);
    expect(await adminOf(HELPER.id)).toBeNull();
    await expect(removeAdmin(boss, HELPER.id)).rejects.toMatchObject({ status: 404 });

    // The address list can change on the server: a superadmin who is taken off it is out.
    process.env.BAMIO_SUPERADMINS = "someone-else@example.com";
    forgetAdminRoles();
    expect(await adminOf(BOSS.id)).toBeNull();

    const log = (await adminActions(10)).filter((a) => a.admin_email === boss.email).map((a) => [a.action, a.target]);
    expect(log).toEqual([
      ["admin.remove", HELPER.id],
      ["admin.add", HELPER.id],
    ]);
  });

  it("gives a free plan, changes it and takes it back, logging each", async () => {
    await setPlanGrant(boss, NOBODY.id, NOBODY.email, "pro");
    expect((await readPlanGrant(NOBODY.id))?.plan).toBe("pro");
    await setPlanGrant(boss, NOBODY.id, NOBODY.email, "starter");
    expect((await readPlanGrant(NOBODY.id))?.plan).toBe("starter");
    await setPlanGrant(boss, NOBODY.id, NOBODY.email, null);
    expect(await readPlanGrant(NOBODY.id)).toBeNull();
    const log = (await adminActions(10)).filter((a) => a.target === NOBODY.id).map((a) => [a.action, a.details.plan]);
    expect(log).toEqual([
      ["plan.revoke", null],
      ["plan.grant", "starter"],
      ["plan.grant", "pro"],
    ]);
  });

  // Its first call loads the whole job system (media tools, transcription): slow on a busy machine.
  it("cancels a job so its owner sees it failed, and retries it the way they would", { timeout: 30_000 }, async () => {
    const p = blankProject({
      title: "A talk",
      source: { kind: "url", url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", platform: "youtube", title: "A talk", durationSec: 0 },
      findClips: true,
      clipLength: "short",
      job: { status: "queued", message: "Waiting to start" },
    });
    await createProject(NOBODY.id, p);
    const { id } = await enqueue({ kind: "import", userId: NOBODY.id, projectId: p.id });

    await expect(adminJobAction(boss, id, "retry")).rejects.toMatchObject({ status: 409 });
    await adminJobAction(boss, id, "cancel");
    expect((await jobById(id))?.status).toBe("cancelled");
    const failed = await getProject(NOBODY.id, p.id);
    expect(failed.job.status).toBe("failed");
    expect(failed.job.error).toMatch(/Stopped by the Bamio team/);
    await expect(adminJobAction(boss, id, "cancel")).rejects.toMatchObject({ status: 409 });

    await adminJobAction(boss, id, "retry");
    expect((await getProject(NOBODY.id, p.id)).job.status).toBe("queued");
    const [again] = await db()<{ id: number; status: string }[]>`select id::int, status from jobs where project_id = ${p.id} and id <> ${id}`;
    expect(again?.status).toBe("queued");
    // The cancelled job isn't the latest any more: retrying it again would run the import twice.
    await expect(adminJobAction(boss, id, "retry")).rejects.toMatchObject({ code: "not_latest" });

    const log = (await adminActions(10)).filter((a) => a.target === String(id)).map((a) => a.action);
    expect(log).toEqual(["job.retry", "job.cancel"]);
    await db()`delete from jobs where project_id = ${p.id}`;
  });
});
