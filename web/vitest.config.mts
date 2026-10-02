import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres@127.0.0.1:54329/bamio_test";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` throws outside Next's server bundle; tests import server modules directly.
      "server-only": fileURLToPath(new URL("./tests/unit/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    // An empty, migrated test database (npm run db:local makes one).
    globalSetup: ["tests/unit/db-setup.ts"],
    // One file at a time: they share the test database (jobs especially).
    fileParallelism: false,
    env: { DATABASE_URL: TEST_DATABASE_URL },
  },
});
