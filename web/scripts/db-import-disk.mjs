#!/usr/bin/env node
/*
 * Copies what the disk store kept as JSON into the database: projects (project.json),
 * transcripts (transcript.json), billing (billing.json) and usage (usage.json) from
 * <data>/users/<userId>/ (BAMIO_DATA_DIR, or web/.data). Media files stay where they are.
 * Reads only; the JSON files are left as they were. Safe to run again: what's already in the
 * database is kept.
 *   node scripts/db-import-disk.mjs
 * Reads web/.env and web/.env.local the same way Next.js does (DATABASE_URL).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import postgres from "postgres";

const root = fileURLToPath(new URL("..", import.meta.url));
nextEnv.loadEnvConfig(root);
const data = path.resolve(process.env.BAMIO_DATA_DIR || path.join(root, ".data"));
const url = process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:54329/bamio";
const USER_ID = /^[A-Za-z0-9_-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
};

const sql = postgres(url, { onnotice: () => undefined, max: 2 });
const count = { projects: 0, transcripts: 0, billing: 0, usage: 0, skipped: 0 };
const usersDir = path.join(data, "users");
try {
  for (const userId of existsSync(usersDir) ? readdirSync(usersDir) : []) {
    if (!USER_ID.test(userId)) continue;
    const userDir = path.join(usersDir, userId);
    const projectsDir = path.join(userDir, "projects");
    for (const id of existsSync(projectsDir) ? readdirSync(projectsDir) : []) {
      if (!UUID.test(id)) continue;
      const project = readJson(path.join(projectsDir, id, "project.json"));
      if (!project || project.id !== id || typeof project.createdAt !== "number" || typeof project.updatedAt !== "number") {
        count.skipped++;
        continue;
      }
      const added = await sql`
        insert into projects (id, user_id, data, created_at, updated_at)
        values (${id}, ${userId}, ${sql.json(project)}, ${project.createdAt}, ${project.updatedAt})
        on conflict (id) do nothing`;
      count.projects += added.count;
      const transcript = readJson(path.join(projectsDir, id, "transcript.json"));
      if (transcript && Array.isArray(transcript.segments)) {
        const t = await sql`insert into transcripts (project_id, data, updated_at) values (${id}, ${sql.json(transcript)}, ${project.updatedAt}) on conflict do nothing`;
        count.transcripts += t.count;
      }
    }
    const billing = readJson(path.join(userDir, "billing.json"));
    if (billing && typeof billing === "object") {
      const b = await sql`insert into billing_accounts (user_id, data, updated_at) values (${userId}, ${sql.json(billing)}, ${Date.now()}) on conflict do nothing`;
      count.billing += b.count;
    }
    const usage = readJson(path.join(userDir, "usage.json"));
    for (const e of Array.isArray(usage?.entries) ? usage.entries : []) {
      if (typeof e.key !== "string" || !(e.sec >= 0) || typeof e.at !== "number") continue;
      const u = await sql`insert into usage_entries (user_id, key, sec, at) values (${userId}, ${e.key}, ${e.sec}, ${e.at}) on conflict do nothing`;
      count.usage += u.count;
    }
  }
  console.log(`✓ Imported ${count.projects} projects, ${count.transcripts} transcripts, ${count.billing} billing records, ${count.usage} usage entries${count.skipped ? ` (skipped ${count.skipped} unreadable projects)` : ""} from ${data}`);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
