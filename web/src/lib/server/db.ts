import "server-only";
import postgres from "postgres";

/*
 * The Postgres client (postgres.js). DATABASE_URL in production; in development and tests
 * the local database from `npm run db:local` unless DATABASE_URL says otherwise. Migrations
 * are SQL files in web/db/migrations (`npm run db:migrate`).
 */

export const LOCAL_DATABASE_URL = "postgres://postgres@127.0.0.1:54329/bamio";

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NODE_ENV === "production") throw new Error("DATABASE_URL isn't set.");
  return LOCAL_DATABASE_URL;
}

export type Sql = postgres.Sql;
/** A transaction (inside `sql.begin`), which runs queries the same way as `Sql`. */
export type Tx = postgres.TransactionSql;

type Cache = { url: string; sql: Sql };
const cache = globalThis as { __bamioDb?: Cache };

/** The shared client (one pool per server process, kept across dev reloads). */
export function db(): Sql {
  const url = databaseUrl();
  if (cache.__bamioDb?.url !== url) {
    void cache.__bamioDb?.sql.end({ timeout: 5 });
    cache.__bamioDb = {
      url,
      sql: postgres(url, {
        max: Number(process.env.DATABASE_POOL_SIZE) || 10,
        idle_timeout: 60,
        connect_timeout: 10,
        onnotice: () => undefined,
      }),
    };
  }
  return cache.__bamioDb.sql;
}

/** True for errors meaning the database can't be reached (rather than a bad query). */
export function isDatabaseDown(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ETIMEDOUT" || code === "CONNECT_TIMEOUT" || code === "57P03";
}
