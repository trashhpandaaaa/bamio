#!/usr/bin/env node
/*
 * A Postgres for development, from the Postgres installed on this computer: its data in
 * web/.pg/, on 127.0.0.1:54329 only (trust login, no password), with the databases `bamio`
 * (the app's default in development) and `bamio_test` (unit tests), both migrated.
 *   npm run db:local            start it (making it the first time)
 *   npm run db:local -- stop    stop it
 *   npm run db:local -- status
 * Finds the Postgres programs through PG_BIN, the PATH, or the usual install folders.
 * Production uses a real database: set DATABASE_URL.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { migrate } from "../db/migrate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const data = path.join(root, ".pg");
const PORT = 54329;
const exe = (name) => (process.platform === "win32" ? `${name}.exe` : name);

function binDir() {
  const candidates = [];
  if (process.env.PG_BIN) candidates.push(process.env.PG_BIN);
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) candidates.push(dir);
  const roots =
    process.platform === "win32"
      ? ["C:\\Program Files\\PostgreSQL"]
      : process.platform === "darwin"
        ? ["/opt/homebrew/opt", "/usr/local/opt", "/Applications/Postgres.app/Contents/Versions"]
        : ["/usr/lib/postgresql"];
  for (const r of roots) {
    if (!existsSync(r)) continue;
    // Newest version first.
    for (const v of readdirSync(r).sort((a, b) => Number.parseFloat(b.replace(/\D+/g, "")) - Number.parseFloat(a.replace(/\D+/g, "")))) candidates.push(path.join(r, v, "bin"));
  }
  const found = candidates.find((dir) => dir && existsSync(path.join(dir, exe("pg_ctl"))) && existsSync(path.join(dir, exe("initdb"))));
  if (!found) {
    console.error("✗ Postgres isn't installed here (no pg_ctl / initdb found). Install Postgres 16 or newer, or set PG_BIN to its bin folder.");
    process.exit(1);
  }
  return found;
}

const bin = binDir();
// No pipes: the server pg_ctl starts would inherit them and keep this script waiting forever (its output goes to server.log).
const pgctl = (...args) => spawnSync(path.join(bin, exe("pg_ctl")), ["-D", data, ...args], { stdio: "ignore" });
const running = () => pgctl("status").status === 0;
const command = process.argv[2] ?? "start";

if (command === "stop") {
  if (!running()) console.log("Not running.");
  else {
    pgctl("stop", "-m", "fast");
    console.log("✓ Stopped.");
  }
  process.exit(0);
}
if (command === "status") {
  console.log(running() ? `Running on 127.0.0.1:${PORT} (data in web/.pg)` : "Not running.");
  process.exit(0);
}

if (!existsSync(path.join(data, "PG_VERSION"))) {
  console.log(`Making a database cluster in web/.pg with ${bin}`);
  execFileSync(path.join(bin, exe("initdb")), ["-D", data, "-U", "postgres", "-A", "trust", "-E", "UTF8", "--locale=C"], { stdio: "inherit" });
}
if (!running()) {
  const args = ["-D", data, "start", "-w", "-t", "60", "-l", path.join(data, "server.log"), "-o", `-p ${PORT} -c listen_addresses=127.0.0.1`];
  if (process.platform === "win32") {
    // Started by Windows' process service, so it belongs to no terminal: a server started from a
    // terminal is stopped with it (0xC000013A, or 0xC0000142 for its helpers, in server.log).
    const line = [path.join(bin, exe("pg_ctl")), ...args].map((a) => `"${a}"`).join(" ").replace(/'/g, "''");
    spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${line}' } | Out-Null`], { stdio: "ignore" });
  } else {
    const child = spawn(path.join(bin, exe("pg_ctl")), args, { detached: true, stdio: "ignore" });
    await new Promise((resolve) => child.on("exit", resolve));
    child.unref();
  }
  for (let i = 0; i < 60 && !running(); i++) await new Promise((r) => setTimeout(r, 1000));
  // Accepting connections, not just started (after an unclean stop it checks its files first, which can take a minute).
  for (let i = 0; i < 120; i++) {
    const probe = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { onnotice: () => undefined, max: 1, connect_timeout: 2 });
    const ok = await probe`select 1`.then(() => true, () => false);
    await probe.end({ timeout: 1 });
    if (ok) break;
    if (i === 119) {
      console.error("✗ Postgres didn't start. See web/.pg/server.log.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const admin = postgres(`postgres://postgres@127.0.0.1:${PORT}/postgres`, { onnotice: () => undefined, max: 1 });
for (const name of ["bamio", "bamio_test"]) {
  const [exists] = await admin`select 1 from pg_database where datname = ${name}`;
  if (!exists) await admin.unsafe(`create database ${name}`);
  const sql = postgres(`postgres://postgres@127.0.0.1:${PORT}/${name}`, { onnotice: () => undefined, max: 1 });
  const applied = await migrate(sql);
  await sql.end();
  console.log(`✓ ${name}${applied.length ? ` (applied ${applied.join(", ")})` : ""}`);
}
await admin.end();
console.log(`\nRunning on 127.0.0.1:${PORT}. In development the app uses postgres://postgres@127.0.0.1:${PORT}/bamio unless DATABASE_URL is set.`);
