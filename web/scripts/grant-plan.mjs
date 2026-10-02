#!/usr/bin/env node
/*
 * Gives a user a plan without paying (the owner, testers, partners), for good, or takes it
 * back. Finds the user in Clerk by email address, so they must have signed up first.
 *   npm run plan:grant -- you@example.com pro        (starter, pro or team)
 *   npm run plan:grant -- you@example.com none       (takes it back)
 *   npm run plan:grant -- --list                     (who has one)
 * On the server: docker compose exec app node scripts/grant-plan.mjs you@example.com pro
 * Uses CLERK_SECRET_KEY (whose users these are: development and production keys have
 * different users) and DATABASE_URL (or the local database in development). Takes effect at
 * once; only matters with plans on (STRIPE_SECRET_KEY), since without them nothing is limited.
 */
import { createClerkClient } from "@clerk/backend";
import nextEnv from "@next/env";
import postgres from "postgres";
import { migrate } from "../db/migrate.mjs";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

// The plan ids of src/lib/billing/plans.ts (the database checks them too).
const PLANS = { starter: "Starter", pro: "Pro", team: "Team" };

const fail = (message) => {
  console.error(`✗ ${message}`);
  process.exit(1);
};

const [email, plan] = process.argv.slice(2);
const list = email === "--list";
if (!list && (!email?.includes("@") || !(plan in PLANS || plan === "none"))) fail("Usage: npm run plan:grant -- you@example.com <starter|pro|team|none>   or   -- --list");

const url = process.env.DATABASE_URL || (process.env.NODE_ENV === "production" ? fail("DATABASE_URL isn’t set.") : "postgres://postgres@127.0.0.1:54329/bamio");
const sql = postgres(url, { max: 1, onnotice: () => undefined, connect_timeout: 10 });
try {
  await migrate(sql, { log: () => undefined });
  if (list) {
    const rows = await sql`select user_id, plan, note, created_at::float8 as created_at from plan_grants order by created_at`;
    if (rows.length === 0) console.log("No plans given.");
    for (const r of rows) console.log(`${PLANS[r.plan] ?? r.plan}\t${r.note ?? ""}\t${r.user_id}\tsince ${new Date(r.created_at).toISOString().slice(0, 10)}`);
  } else {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) fail("CLERK_SECRET_KEY isn’t set.");
    const instance = secretKey.startsWith("sk_live_") ? "production" : "development";
    const { data } = await createClerkClient({ secretKey }).users.getUserList({ emailAddress: [email], limit: 2 });
    if (data.length === 0) fail(`No user with ${email} in Clerk (${instance} keys). Sign up with that address on this site first.`);
    const userId = data[0].id;
    if (plan === "none") {
      const removed = await sql`delete from plan_grants where user_id = ${userId}`;
      console.log(removed.count ? `✓ ${email} no longer has a free plan.` : `${email} had no free plan.`);
    } else {
      await sql`
        insert into plan_grants (user_id, plan, note, created_at) values (${userId}, ${plan}, ${email}, ${Date.now()})
        on conflict (user_id) do update set plan = excluded.plan, note = excluded.note`;
      console.log(`✓ ${email} has Bamio ${PLANS[plan]} for free, for good (Clerk ${instance} user ${userId}).`);
    }
  }
} finally {
  await sql.end({ timeout: 5 });
}
