import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
// Another server instead of the local one, for read-only checks (the sweep's public pages): E2E_BASE_URL=https://bamio.app
const BASE = process.env.E2E_BASE_URL?.replace(/\/+$/, "");

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: BASE ?? `http://localhost:${PORT}`,
    // Uses the installed Microsoft Edge, so no browser download is needed.
    channel: process.env.E2E_CHANNEL ?? "msedge",
    headless: true,
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: BASE
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: `http://localhost:${PORT}/`,
        // Next allows one dev server per project; reuse it if it is already running (in mock mode).
        reuseExistingServer: true,
        timeout: 120_000,
        // Plans off, whatever web/.env says; E2E_BILLING turns them on with a fake key, so no request reaches a real Stripe account.
        // Emails are written and logged, never sent (web/.env may hold a Resend key). Campaign clips' views aren't looked up on their sites.
        // No ads either: the suite never calls Google.
        env: { BAMIO_AI_MOCK: "1", BAMIO_EMAIL: "preview", BAMIO_VIEW_COUNTS: "off", BAMIO_ADS: "off", ...(process.env.E2E_BILLING ? { STRIPE_SECRET_KEY: "sk_test_e2e_fake" } : { BAMIO_BILLING: "off" }) },
      },
});
