import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { migrate } from "../../db/migrate.mjs";

/*
 * Before the unit tests: an empty, migrated test database. TEST_DATABASE_URL, or the local
 * one from `npm run db:local`, which is started here if it isn't running (and stopped again
 * after the tests). Only a database whose name ends in "_test" is ever wiped.
 */
const LOCAL_TEST_URL = "postgres://postgres@127.0.0.1:54329/bamio_test";
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? LOCAL_TEST_URL;

const reachable = async (url: string) => {
  const probe = postgres(url, { onnotice: () => undefined, max: 1, connect_timeout: 3 });
  const ok = await probe`select 1`.then(() => true, () => false);
  await probe.end({ timeout: 1 });
  return ok;
};

const dbLocal = (...args: string[]) => execFileSync(process.execPath, [path.join("scripts", "db-local.mjs"), ...args], { stdio: "inherit" });

export default async function setup() {
  const name = new URL(TEST_DATABASE_URL).pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`Refusing to reset "${name}": the test database's name must end in _test.`);
  let started = false;
  if (!(await reachable(TEST_DATABASE_URL))) {
    // The local development database: start it (the first time, make it).
    if (TEST_DATABASE_URL === LOCAL_TEST_URL && existsSync(path.join("scripts", "db-local.mjs"))) {
      dbLocal();
      started = true;
    }
    if (!(await reachable(TEST_DATABASE_URL))) {
      throw new Error(`The unit tests need Postgres at ${TEST_DATABASE_URL}. Run npm run db:local (or set TEST_DATABASE_URL).`);
    }
  }
  const sql = postgres(TEST_DATABASE_URL, { onnotice: () => undefined, max: 1 });
  await sql.unsafe("drop schema if exists public cascade; create schema public;");
  await migrate(sql);
  await sql.end();
  // Leave things as they were.
  return () => {
    if (started) dbLocal("stop");
  };
}
