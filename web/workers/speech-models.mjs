/*
 * The on-device speech models, downloaded when first needed into web/.models (or
 * BAMIO_MODELS_DIR) and checked against pinned SHA-256 hashes. Used by
 * `npm run setup:media` and by workers/transcribe.mjs. int8 ONNX exports by the
 * sherpa-onnx project.
 *
 * Which model transcribes what (see engineFor in transcribe-core.mjs), with
 * BAMIO_SPEECH_MODEL=accurate (default) or fast:
 *   English:   NVIDIA Parakeet TDT 0.6B v2 (about 480 MB) or 110M (about 110 MB), CC-BY-4.0.
 *   European:  NVIDIA Parakeet TDT 0.6B v3 (about 490 MB), CC-BY-4.0: 24 more European
 *              languages, with punctuation and capitals.
 *   Any other: Meta Omnilingual ASR CTC 1B (about 790 MB) or 300M (about 290 MB),
 *              Apache-2.0: 1,600+ languages, lowercase without punctuation.
 *   Detecting the language: OpenAI Whisper tiny (about 115 MB), MIT.
 *   Finding the speech: Silero VAD (MIT).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const RELEASE = "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/";

const transducer = { encoder: "encoder.int8.onnx", decoder: "decoder.int8.onnx", joiner: "joiner.int8.onnx", tokens: "tokens.txt" };
const ctc = { model: "model.int8.onnx", tokens: "tokens.txt" };

/** Model archives: folder name (= archive name), files used, size and hash of the archive. */
export const MODELS = {
  "english-accurate": { dir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", kind: "transducer", files: transducer, sha256: "157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad", bytes: 482_468_385 },
  "english-fast": { dir: "sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8", kind: "transducer", files: transducer, sha256: "f628312e9fdf8686374cb01a69425c41732529d540860311f16f37cbc32cfe9b", bytes: 108_035_095 },
  european: { dir: "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8", kind: "transducer", files: transducer, sha256: "5793d0fd397c5778d2cf2126994d58e9d56b1be7c04d13c7a15bb1b4eafb16bf", bytes: 487_170_055 },
  "omni-accurate": { dir: "sherpa-onnx-omnilingual-asr-1600-languages-1B-ctc-v2-int8-2026-02-05", kind: "omnilingual", files: ctc, sha256: "f4deae6e6cbf4ca785b89eaa3836156581208bf977ea2e6d7ae84d7efcfc3a40", bytes: 787_296_506 },
  "omni-fast": { dir: "sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-v2-int8-2026-02-05", kind: "omnilingual", files: ctc, sha256: "951b32409aade32bd525310bb39e9666773ba3fc611a39e817f620936d76c631", bytes: 292_313_120 },
  // The archive also holds float32 copies, deleted after unpacking.
  lid: { dir: "sherpa-onnx-whisper-tiny", kind: "whisper", files: { encoder: "tiny-encoder.int8.onnx", decoder: "tiny-decoder.int8.onnx", tokens: "tiny-tokens.txt" }, sha256: "c46116994e539aa165266d96b325252728429c12535eb9d8b6a2b10f129e66b1", bytes: 116_204_861, drop: ["tiny-encoder.onnx", "tiny-decoder.onnx"] },
};
const VAD = {
  url: `${RELEASE}silero_vad.onnx`,
  sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
  bytes: 643_854,
};

/** "accurate" unless BAMIO_SPEECH_MODEL=fast. */
export const modelChoice = (value = process.env.BAMIO_SPEECH_MODEL) => (value === "fast" ? "fast" : "accurate");

/** The model key for an engine ("english", "european", "omni", "lid") and a choice. */
export function modelKey(engine, choice = modelChoice()) {
  if (engine === "european" || engine === "lid") return engine;
  return `${engine}-${choice}`;
}

/** Absolute paths of a model's files, plus the VAD model. */
export function modelFiles(dir, key) {
  const model = MODELS[key];
  const base = path.join(dir, model.dir);
  return { ...Object.fromEntries(Object.entries(model.files).map(([k, f]) => [k, path.join(base, f)])), vad: path.join(dir, "silero_vad.onnx") };
}

export function modelsPresent(dir, keys) {
  return keys.every((key) => Object.values(modelFiles(dir, key)).every((f) => existsSync(f)));
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
 * Make sure the given models (and the VAD) are in `dir`, downloading what's missing.
 * @param {string} dir
 * @param {(keyof typeof MODELS)[]} keys
 * @param {(progress: number) => void} [onProgress]  0..1 over everything downloaded
 */
export async function ensureModels(dir, keys, onProgress) {
  if (modelsPresent(dir, keys)) return;
  await mkdir(dir, { recursive: true });
  const vadPath = path.join(dir, "silero_vad.onnx");
  const missing = keys.filter((key) => !modelsPresent(dir, [key]));
  const total = (existsSync(vadPath) ? 0 : VAD.bytes) + missing.reduce((a, key) => a + MODELS[key].bytes, 0);
  let done = 0;
  if (!existsSync(vadPath)) {
    await download(VAD, vadPath, (p) => onProgress?.((p * VAD.bytes) / total));
    done += VAD.bytes;
  }
  for (const key of missing) {
    const model = MODELS[key];
    const archive = path.join(dir, `${model.dir}.tar.bz2`);
    await download({ ...model, url: `${RELEASE}${model.dir}.tar.bz2` }, archive, (p) => onProgress?.((done + p * model.bytes) / total));
    done += model.bytes;
    // tar ships with Windows 10+, macOS and Linux, and detects bzip2 itself.
    const res = spawnSync("tar", ["-xf", archive, "-C", dir], { encoding: "utf8", windowsHide: true });
    await rm(archive, { force: true });
    if (res.status !== 0) throw new Error(`Could not unpack the speech model: ${res.stderr || res.error?.message || "tar failed"}`);
    for (const f of model.drop ?? []) await rm(path.join(dir, model.dir, f), { force: true });
    await rm(path.join(dir, model.dir, "test_wavs"), { recursive: true, force: true });
  }
  if (!modelsPresent(dir, keys)) throw new Error("The speech model files are incomplete after downloading.");
}
