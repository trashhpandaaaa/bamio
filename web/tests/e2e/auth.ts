import path from "node:path";
import { clerk } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";

/** Clerk treats "+clerk_test" addresses as test accounts in development instances: no real email is sent. */
export const E2E_EMAIL = "bamio-e2e+clerk_test@example.com";
/** This Clerk instance requires usernames at sign-up. */
export const E2E_USERNAME = "bamio_e2e";

/** Made by global-setup with the bundled ffmpeg (qa/ is gitignored): a test pattern with ~20 s of speech. */
export const SAMPLE_VIDEO = path.join(process.cwd(), "qa", "fixtures", "sample-talk.mp4");

/** Sign the e2e user in with a server-issued ticket (no password or email code needed). */
export async function signIn(page: Page) {
  await page.goto("/");
  await clerk.signIn({ page, emailAddress: E2E_EMAIL });
}
