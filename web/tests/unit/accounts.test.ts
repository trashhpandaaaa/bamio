import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteNextAccount, requestAccountDeletion, type AccountDeps } from "@/lib/server/accounts";
import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";
import { addUsage, blankProject, createProject, mediaKeys, writeTranscript } from "@/lib/server/store";

/* Deleting an account: every row and file about the user goes, nobody else's, and a failure is tried again. */

const GONE = "user_del_gone";
const KEPT = "user_del_kept";
const USERS = [GONE, KEPT];

function fakes(fail?: Error) {
  const calls: string[] = [];
  const deps: AccountDeps = {
    closeBilling: async (u) => {
      calls.push(`stripe:${u}`);
      if (fail) throw fail;
    },
    stopProject: async (p) => void calls.push(`stop:${p}`),
    deleteClerkUser: async (u) => void calls.push(`clerk:${u}`),
  };
  return { deps, calls };
}

let dir: string;
const quiet = () => undefined;

async function seed(userId: string) {
  const p = blankProject({
    title: "Mine",
    source: { kind: "upload", platform: "upload", title: "Mine", durationSec: 30 },
    findClips: true,
    clipLength: "short",
    job: { status: "ready", message: "Ready" },
  });
  await createProject(userId, p);
  await writeTranscript(userId, p.id, { language: "en", segments: [] });
  const file = path.join(dir, `${userId}.jpg`);
  await writeFile(file, "jpg");
  await storage().publish(mediaKeys(userId, p.id).thumb, file, "image/jpeg");
  const sql = db();
  const now = Date.now();
  await sql`insert into jobs (kind, user_id, project_id, run_after, created_at, updated_at, status) values ('export', ${userId}, ${p.id}, ${now}, ${now}, ${now}, 'done')`;
  await sql`insert into billing_accounts (user_id, data, updated_at) values (${userId}, ${sql.json({ customerId: `cus_${userId}` })}, ${now})`;
  await addUsage(userId, `import:${p.id}`, 30);
  await sql`insert into plan_grants (user_id, plan, note, created_at) values (${userId}, 'pro', 'test', ${now})`;
  await sql`insert into referral_codes (user_id, code, created_at) values (${userId}, ${`c${userId.slice(-4)}`}, ${now})`;
  await sql`insert into emails (user_id, key, template, category, data, run_after, created_at, updated_at) values (${userId}, 'k', 'video-ready', 'videos', '{}', ${now}, ${now}, ${now})`;
  await sql`insert into admins (user_id, email, added_by, created_at) values (${userId}, 'x@example.com', 'test', ${now})`;
  await sql`insert into clipper_profiles (user_id, name, status, created_at, updated_at) values (${userId}, 'Clipper', 'approved', ${now}, ${now})`;
  return p;
}

const counts = async (userId: string) => {
  const sql = db();
  const [r] = await sql<Record<string, number>[]>`select
    (select count(*)::int from projects where user_id = ${userId}) as projects,
    (select count(*)::int from transcripts t join projects p on p.id = t.project_id where p.user_id = ${userId}) as transcripts,
    (select count(*)::int from jobs where user_id = ${userId}) as jobs,
    (select count(*)::int from billing_accounts where user_id = ${userId}) as billing,
    (select count(*)::int from usage_entries where user_id = ${userId}) as usage,
    (select count(*)::int from plan_grants where user_id = ${userId}) as grants,
    (select count(*)::int from referral_codes where user_id = ${userId}) as codes,
    (select count(*)::int from emails where user_id = ${userId}) as emails,
    (select count(*)::int from admins where user_id = ${userId}) as admins,
    (select count(*)::int from clipper_profiles where user_id = ${userId}) as clippers`;
  return r!;
};

async function clean() {
  const sql = db();
  for (const u of USERS) {
    for (const t of ["projects", "jobs", "billing_accounts", "usage_entries", "plan_grants", "referral_codes", "emails", "admins", "clipper_profiles", "account_deletions"]) {
      await sql`delete from ${sql(t)} where user_id = ${u}`;
    }
  }
}

describe("deleting an account", () => {
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bamio-accounts-"));
    process.env.BAMIO_DATA_DIR = dir;
  });
  afterAll(async () => {
    await clean();
    delete process.env.BAMIO_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });
  beforeEach(clean);

  it("ends the plan, then removes every row and file about the user, and the Clerk user, and nobody else's", async () => {
    const mine = await seed(GONE);
    const theirs = await seed(KEPT);
    await requestAccountDeletion(GONE, "self");
    await requestAccountDeletion(GONE, "clerk"); // asked twice (the webhook after the profile): once
    const { deps, calls } = fakes();
    expect(await deleteNextAccount(deps, quiet)).toBe(true);
    expect(await deleteNextAccount(deps, quiet)).toBe(false);

    expect(calls).toEqual([`stripe:${GONE}`, `stop:${mine.id}`, `clerk:${GONE}`]);
    expect(Object.values(await counts(GONE)).every((n) => n === 0)).toBe(true);
    expect(await storage().stat(mediaKeys(GONE, mine.id).thumb)).toBeNull();
    const [row] = await db()<{ status: string; reason: string }[]>`select status, reason from account_deletions where user_id = ${GONE}`;
    expect(row).toEqual({ status: "done", reason: "self" });

    expect(await counts(KEPT)).toEqual({ projects: 1, transcripts: 1, jobs: 1, billing: 1, usage: 1, grants: 1, codes: 1, emails: 1, admins: 1, clippers: 1 });
    expect(await storage().stat(mediaKeys(KEPT, theirs.id).thumb)).not.toBeNull();
  });

  it("tries again later when a step fails, and leaves the data until it works", async () => {
    await seed(GONE);
    await requestAccountDeletion(GONE, "clerk");
    const failing = fakes(new Error("Stripe is down"));
    expect(await deleteNextAccount(failing.deps, quiet)).toBe(true);
    const [row] = await db()<{ status: string; last_error: string; run_after: number }[]>`select status, last_error, run_after::float8 as run_after from account_deletions where user_id = ${GONE}`;
    expect(row).toMatchObject({ status: "queued", last_error: "Stripe is down" });
    expect(row!.run_after).toBeGreaterThan(Date.now());
    expect((await counts(GONE)).projects).toBe(1);
    // Not due yet; once it is, it works.
    expect(await deleteNextAccount(fakes().deps, quiet)).toBe(false);
    expect(await deleteNextAccount(fakes().deps, quiet, row!.run_after + 1)).toBe(true);
    expect((await counts(GONE)).projects).toBe(0);
  });
});
