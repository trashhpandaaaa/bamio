/*
 * Applies db/migrations/*.sql in name order, each once, each in its own transaction, recorded
 * in schema_migrations. An advisory lock keeps two migrators (two deploys) from racing.
 * Used by `npm run db:migrate`, the local database script and the unit tests' setup.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const LOCK = 7_314_215_901; // any constant: "bamio migrations"

/** `sql`: a postgres.js client. Returns the names of the migrations it applied. */
export async function migrate(sql, { log = () => undefined } = {}) {
  const files = readdirSync(DIR).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
  const applied = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(${LOCK})`;
    await tx`create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())`;
    const done = new Set((await tx`select version from schema_migrations`).map((r) => r.version));
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(readFileSync(path.join(DIR, file), "utf8"));
      await tx`insert into schema_migrations (version) values (${file})`;
      applied.push(file);
      log(`applied ${file}`);
    }
  });
  return applied;
}
