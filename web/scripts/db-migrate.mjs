#!/usr/bin/env node
/*
 * Brings the database at DATABASE_URL (or the local development one) up to date.
 *   npm run db:migrate
 * Reads web/.env and web/.env.local the same way Next.js does. Run it before starting a new
 * version (the Docker image does).
 */
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import postgres from "postgres";
import { migrate } from "../db/migrate.mjs";

nextEnv.loadEnvConfig(fileURLToPath(new URL("..", import.meta.url)));
const url = process.env.DATABASE_URL || (process.env.NODE_ENV === "production" ? "" : "postgres://postgres@127.0.0.1:54329/bamio");
if (!url) {
  console.error("✗ DATABASE_URL isn't set.");
  process.exit(1);
}
const sql = postgres(url, { onnotice: () => undefined, max: 1 });
try {
  const applied = await migrate(sql, { log: (m) => console.log(`✓ ${m}`) });
  if (applied.length === 0) console.log("✓ Up to date.");
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
