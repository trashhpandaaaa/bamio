import { randomBytes } from "node:crypto";
import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

/*
 * Deleting an account from the profile, with a throwaway Clerk test user (the shared e2e user
 * stays): the plan ends, every row goes, and the Clerk user is deleted. Also: the legal pages
 * open, and Clerk's own Delete account (which would leave the plan running) is hidden.
 */

const sql = postgres(process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/bamio", { onnotice: () => undefined, max: 2 });
test.afterAll(() => sql.end());

test("deleting an account removes everything, and signs out", async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const backend = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  const tag = randomBytes(5).toString("hex");
  const email = `bamio-delete-${tag}+clerk_test@example.com`;
  const user = await backend.users.createUser({
    emailAddress: [email],
    username: `bamio_delete_${tag}`,
    password: `Bm-${randomBytes(18).toString("base64url")}`,
    skipPasswordChecks: true,
  });
  try {
    await page.goto("/");
    await clerk.signIn({ page, emailAddress: email });
    // A project (no video needed) and a usage record, so there are rows to delete.
    const created = await page.request.post("/api/projects/upload", { data: { fileName: "mine.mp4", size: 1000, findClips: false, clipLength: "short", language: "auto" } });
    expect(created.ok()).toBe(true);
    await sql`insert into usage_entries (user_id, key, sec, at) values (${user.id}, 'e2e-delete', 60, ${Date.now()})`;
    expect((await sql`select 1 from projects where user_id = ${user.id}`).length).toBe(1);

    await page.goto("/profile/security");
    await expect(page.locator(".cl-profileSection__danger")).toBeHidden();
    await page.goto("/profile/delete-account");
    await expect(page.getByRole("heading", { name: "Delete account" })).toBeVisible();
    const button = page.getByRole("button", { name: "Delete my account" });
    await expect(button).toBeDisabled();
    await page.getByLabel("I understand this deletes everything").check();
    await button.click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete everything" }).click();
    await page.waitForURL(/\/\?account=deleted$/, { timeout: 30_000 });

    // The workers do the rest within seconds.
    await expect
      .poll(async () => (await sql<{ status: string }[]>`select status from account_deletions where user_id = ${user.id}`)[0]?.status, { timeout: 60_000 })
      .toBe("done");
    expect((await sql`select 1 from projects where user_id = ${user.id}`).length).toBe(0);
    expect((await sql`select 1 from usage_entries where user_id = ${user.id}`).length).toBe(0);
    await expect(backend.users.getUser(user.id)).rejects.toMatchObject({ status: 404 });
  } finally {
    await backend.users.deleteUser(user.id).catch(() => undefined);
    await sql`delete from account_deletions where user_id = ${user.id}`;
    await sql`delete from projects where user_id = ${user.id}`;
    await sql`delete from usage_entries where user_id = ${user.id}`;
  }
});

test("the legal pages open, and stay out of search until the company's details are in", async ({ page }) => {
  for (const [path, title] of [
    ["/terms", "Terms of service"],
    ["/privacy", "Privacy policy"],
    ["/takedown", "Copyright and takedowns"],
  ] as const) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    const robots = await page.locator('meta[name="robots"]').getAttribute("content");
    const draft = await page.getByText(/Draft: the company’s details are placeholders/).count();
    // A draft isn't indexed; the real thing is.
    expect(draft === 1 ? robots?.includes("noindex") : !robots?.includes("noindex"), path).toBe(true);
  }
});
