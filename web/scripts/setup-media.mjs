#!/usr/bin/env node
/*
 * 1. Downloads the official yt-dlp binary for this OS into web/.bin/ and verifies it
 *    against the release's SHA2-256SUMS. Re-run any time to update (sites change often).
 * 2. Downloads the on-device speech models (Parakeet TDT 110M and Silero VAD, about 110 MB,
 *    checksum verified) into web/.models/ (or BAMIO_MODELS_DIR), so the first import doesn't wait.
 *   npm run setup:media
 * ffmpeg and ffprobe come from the ffmpeg-static / ffprobe-static npm packages.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";

const RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";
const asset =
  platform() === "win32" ? "yt-dlp.exe" : platform() === "darwin" ? "yt-dlp_macos" : arch() === "arm64" ? "yt-dlp_linux_aarch64" : "yt-dlp_linux";
const binDir = fileURLToPath(new URL("../.bin/", import.meta.url));
const target = `${binDir}${platform() === "win32" ? "yt-dlp.exe" : "yt-dlp"}`;

async function get(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

console.log(`Downloading ${asset} from the latest yt-dlp release…`);
const [binary, sums] = await Promise.all([get(RELEASE + asset), get(`${RELEASE}SHA2-256SUMS`)]);
const expected = sums
  .toString("utf8")
  .split(/\r?\n/)
  .map((line) => line.trim().split(/\s+/))
  .find(([, name]) => name === asset)?.[0];
if (!expected) throw new Error(`No checksum for ${asset} in SHA2-256SUMS`);
const actual = createHash("sha256").update(binary).digest("hex");
if (actual !== expected) throw new Error(`Checksum mismatch for ${asset}: expected ${expected}, got ${actual}`);

await mkdir(binDir, { recursive: true });
await writeFile(`${target}.download`, binary);
await rename(`${target}.download`, target);
if (platform() !== "win32") await chmod(target, 0o755);
console.log(`✓ yt-dlp saved to ${target} (sha256 verified)`);

const modelsDir = process.env.BAMIO_MODELS_DIR || fileURLToPath(new URL("../.models/", import.meta.url));
console.log("Downloading the speech models (first time only, about 110 MB)…");
const worker = fileURLToPath(new URL("../workers/transcribe.mjs", import.meta.url));
const prefetch = spawnSync(process.execPath, [worker, "--prefetch", modelsDir], { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
if (prefetch.status !== 0 || !prefetch.stdout.includes("READY")) throw new Error("Could not download the speech models.");
console.log(`✓ speech models ready in ${modelsDir}`);
