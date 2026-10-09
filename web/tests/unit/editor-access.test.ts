import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { can, TOP_LEVEL } from "@/lib/editor/features";
import { db } from "@/lib/server/db";
import { editorLevel } from "@/lib/server/editor-access";

/* Which of the editor's features an account has: the plan that works for it now. */

const MIRA = "user_editor_mira";
const OTTO = "user_editor_otto";
const ADA = "user_editor_ada";

describe("the editor's plan", () => {
  const tidy = async () => {
    const sql = db();
    for (const u of [MIRA, OTTO, ADA]) {
      await sql`delete from billing_accounts where user_id = ${u}`;
      await sql`delete from plan_grants where user_id = ${u}`;
      await sql`delete from admins where user_id = ${u}`;
    }
    delete process.env.STRIPE_SECRET_KEY;
  };
  beforeEach(tidy);
  afterAll(tidy);

  /** A subscription as Stripe's webhooks would have saved it (read just now, so nothing asks Stripe). */
  const subscribe = async (userId: string, plan: string, status = "active") => {
    const now = Date.now();
    const subscription = { id: `sub_${userId}`, status, plan, interval: "month", anchor: now - 86400_000, periodEnd: now + 29 * 86400_000, cancelAt: null, checkedAt: now };
    await db()`insert into billing_accounts (user_id, data, updated_at) values (${userId}, ${db().json({ customerId: `cus_${userId}`, subscription })}, ${now})
      on conflict (user_id) do update set data = excluded.data`;
  };

  it("is everything while plans are off", async () => {
    expect(await editorLevel(MIRA)).toBe(TOP_LEVEL);
  });

  it("is the plan that works now: paid or given, not the free trial, not one that has ended", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    // A new account has its free video, which isn't a plan: the basics.
    expect(await editorLevel(MIRA)).toBe("free");
    expect(can(await editorLevel(MIRA), "hd")).toBe(false);

    await subscribe(OTTO, "starter");
    expect(await editorLevel(OTTO)).toBe("starter");
    expect(can(await editorLevel(OTTO), "hd")).toBe(true);
    expect(can(await editorLevel(OTTO), "silence")).toBe(false);
    await subscribe(OTTO, "pro");
    expect(await editorLevel(OTTO)).toBe("pro");
    expect(can(await editorLevel(OTTO), "silence")).toBe(true);
    // Stripe still retrying a payment: the plan still works. Cancelled: it doesn't.
    await subscribe(OTTO, "pro", "past_due");
    expect(await editorLevel(OTTO)).toBe("pro");
    await subscribe(OTTO, "pro", "canceled");
    expect(await editorLevel(OTTO)).toBe("free");

    // A plan given without paying is a plan.
    await db()`insert into plan_grants (user_id, plan, note, created_at) values (${MIRA}, 'pro', 'test', ${Date.now()})`;
    expect(await editorLevel(MIRA)).toBe("pro");
  });

  it("is everything for an admin, plan or no plan", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_unit";
    await db()`insert into admins (user_id, email, added_by, created_at) values (${ADA}, 'ada-editor@example.com', 'test', ${Date.now()})`;
    expect(await editorLevel(ADA)).toBe(TOP_LEVEL);
  });
});
