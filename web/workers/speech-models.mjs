/*
 * The on-device speech models, downloaded once into web/.models (or BAMIO_MODELS_DIR)
 * and checked against pinned SHA-256 hashes. Used by `npm run setup:media` and, if the
 * models are missing, by workers/transcribe.mjs on first use.
 *
 *   Parakeet TDT 110M (English, NVIDIA, CC-BY-4.0), int8 ONNX export by sherpa-onnx.
 *   Silero VAD (MIT): finds the parts of the audio with speech.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";

export const PARAKEET_DIR = "sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8";
const PARAKEET = {
  url: `${RELEASE}${PARAKEET_DIR}.tar.bz2`,
  sha256: "f628312e9fdf8686374cb01a69425c41732529d540860311f16f37cbc32cfe9b",
  bytes: 108_035_095,
};
const VAD = {
  url: `${RELEASE}silero_vad.onnx`,
  sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
  bytes: 643_854,
};

/** Paths of the model files inside `dir`. */
export function modelPaths(dir) {
  const p = path.join(dir, PARAKEET_DIR);
  return {
    encoder: path.join(p, "encoder.int8.onnx"),
    decoder: path.join(p, "decoder.int8.onnx"),
    joiner: path.join(p, "joiner.int8.onnx"),
    tokens: path.join(p, "tokens.txt"),
    vad: path.join(dir, "silero_vad.onnx"),
  };
}

export function modelsPresent(dir) {
  return Object.values(modelPaths(dir)).every((f) => existsSync(f));
}

/** Download a file, reporting progress, and check its hash before keeping it. */
async function download(file, target, onProgress) {
  const res = await fetch(file.url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${file.url} (HTTP ${res.status})`);
  const tmp = `${target}.download`;
  const hash = createHash("sha256");
  let loaded = 0;
  const counted = Readable.fromWeb(res.body).on("data", (chunk) => {
    hash.update(chunk);
    loaded += chunk.length;
    onProgress?.(loaded / file.bytes);
  });
  await pipeline(counted, createWriteStream(tmp));
  const actual = hash.digest("hex");
  if (actual !== file.sha256) {
    await rm(tmp, { force: true });
    throw new Error(`Checksum mismatch for ${path.basename(target)}: expected ${file.sha256}, got ${actual}`);
  }
  await rename(tmp, target);
}

/**
 * Make sure the models are in `dir`, downloading them if needed (about 110 MB).
 * @param {string} dir
 * @param {(progress: number) => void} [onProgress]  0..1 over the whole download
 */
export async function ensureModels(dir, onProgress) {
  if (modelsPresent(dir)) return;
  await mkdir(dir, { recursive: true });
  const paths = modelPaths(dir);
  const total = VAD.bytes + PARAKEET.bytes;
  if (!existsSync(paths.vad)) await download(VAD, paths.vad, (p) => onProgress?.((p * VAD.bytes) / total));
  if (!existsSync(paths.encoder) || !existsSync(paths.tokens)) {
    const archive = path.join(dir, `${PARAKEET_DIR}.tar.bz2`);
    await download(PARAKEET, archive, (p) => onProgress?.((VAD.bytes + p * PARAKEET.bytes) / total));
    // tar ships with Windows 10+, macOS and Linux, and detects bzip2 itself.
    const res = spawnSync("tar", ["-xf", archive, "-C", dir], { encoding: "utf8", windowsHide: true });
    await rm(archive, { force: true });
    if (res.status !== 0) throw new Error(`Could not unpack the speech model: ${res.stderr || res.error?.message || "tar failed"}`);
  }
  if (!modelsPresent(dir)) throw new Error("The speech model files are incomplete after downloading.");
}
