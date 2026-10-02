#!/usr/bin/env node
/*
 * Bundles the worker process (src/worker/main.ts) into dist/worker.mjs: the app's server code
 * in one file, packages left as imports from node_modules (native ones like the speech engine
 * load normally). `@/` paths come from tsconfig.json.
 *   npm run build:worker   then   npm run worker
 */
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
await build({
  absWorkingDir: root,
  entryPoints: ["src/worker/main.ts"],
  outfile: "dist/worker.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  packages: "external",
  // The marker package throws outside React's server build: the worker is server code by definition.
  alias: { "server-only": "./src/worker/server-only.ts" },
  sourcemap: true,
  logLevel: "warning",
});
console.log("✓ dist/worker.mjs");
