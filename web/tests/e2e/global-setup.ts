import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createClerkClient } from "@clerk/backend";
import { clerkSetup } from "@clerk/testing/playwright";
import { loadEnvConfig } from "@next/env";
import { ensureModels } from "../../workers/speech-models.mjs";
import { E2E_EMAIL, E2E_USERNAME, SAMPLE_VIDEO } from "./auth";

/*
 * Runs once before the suite:
 * 1. Loads the Clerk keys from web/.env the same way Next.js does (values are never printed).
 * 2. Fetches a Clerk testing token so automated browsers pass bot protection.
 * 3. Makes sure the e2e test user exists in the development instance.
 * 4. Generates the sample video the upload tests use (40 s, 1280x720, with speech), and makes
 *    sure the on-device speech models are downloaded (English is transcribed for real, even
 *    with mock AI).
 */
export default async function globalSetup() {
  loadEnvConfig(process.cwd());
  makeSampleVideo();
  await ensureModels(process.env.BAMIO_MODELS_DIR || path.join(process.cwd(), ".models"));
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!secretKey || !publishableKey) {
    throw new Error("Clerk keys are missing. Run `clerk init` in web/ so .env has the publishable and secret keys.");
  }
  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("End-to-end tests only run against a Clerk development instance (sk_test_ key).");
  }
  process.env.CLERK_PUBLISHABLE_KEY ??= publishableKey;
  await clerkSetup({ publishableKey, secretKey });

  const clerk = createClerkClient({ secretKey });
  const { data } = await clerk.users.getUserList({ emailAddress: [E2E_EMAIL] });
  if (data.length > 0) return;

  // Instances differ in which fields they require or accept (username, password, names). Try the fullest
  // user first, then fall back to email only, and report Clerk's reasons if all fail.
  const attempts = [
    { emailAddress: [E2E_EMAIL], username: E2E_USERNAME, password: `Bm-${randomBytes(18).toString("base64url")}`, skipPasswordChecks: true, firstName: "Bamio", lastName: "Tester" },
    { emailAddress: [E2E_EMAIL], username: E2E_USERNAME, password: `Bm-${randomBytes(18).toString("base64url")}`, skipPasswordChecks: true },
    { emailAddress: [E2E_EMAIL], username: E2E_USERNAME, skipPasswordRequirement: true },
  ];
  const reasons: string[] = [];
  for (const params of attempts) {
    try {
      await clerk.users.createUser(params);
      return;
    } catch (err) {
      const errors = (err as { errors?: { code?: string; message?: string; longMessage?: string }[] }).errors ?? [];
      reasons.push(errors.map((e) => `${e.code}: ${e.longMessage ?? e.message}`).join("; ") || String(err));
    }
  }
  throw new Error(`Could not create the e2e test user:\n- ${reasons.join("\n- ")}`);
}

/**
 * A 40-second test pattern with the committed speech track (then silence), big enough
 * (about 15 MB) to upload in two chunks.
 */
function makeSampleVideo() {
  if (existsSync(SAMPLE_VIDEO)) return;
  mkdirSync(path.dirname(SAMPLE_VIDEO), { recursive: true });
  const ffmpeg = path.join(process.cwd(), "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const res = spawnSync(
    ffmpeg,
    [
      "-hide_banner", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=40",
      "-i", path.join(process.cwd(), "tests", "e2e", "fixtures", "speech.mp3"),
      "-c:v", "libx264", "-preset", "ultrafast", "-b:v", "3M", "-pix_fmt", "yuv420p",
      "-af", "apad", "-t", "40",
      "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
      SAMPLE_VIDEO,
    ],
    { windowsHide: true, encoding: "utf8" },
  );
  if (res.status !== 0) throw new Error(`Could not make the sample video: ${res.stderr?.slice(-500)}`);
}
