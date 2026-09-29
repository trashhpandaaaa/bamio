/*
 * On-device transcription with word timing, in any language. Run by the server as a
 * separate Node process (the models are CPU-heavy and would otherwise stall the web server):
 *
 *   node workers/transcribe.mjs <job.json>                 transcribe, write job.out
 *   node workers/transcribe.mjs --prefetch <dir> [accurate|fast] [all|english]
 *                                                          download the models into <dir>
 *
 * job.json: { pcm, modelsDir, language, model, threads, out }. pcm is raw 16 kHz mono signed
 * 16-bit audio; language is a code such as "hi", or "auto" to detect it; model is "accurate"
 * (default) or "fast" (see speech-models.mjs).
 *
 * Whisper tiny detects the language from speech at three points of the video (unless it
 * was given). Silero VAD finds the speech, and the language's model (Parakeet for English
 * and 24 European languages, Omnilingual ASR for the rest) transcribes each part and gives
 * every token a time. Prints "LANGUAGE <code>" once known, "DOWNLOAD <0..1>" while fetching
 * models the first time and "PROGRESS <0..1>" while transcribing; writes { language, segments }
 * to job.out.
 */
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ensureModels, MODELS, modelChoice, modelFiles, modelKey } from "./speech-models.mjs";
import { engineFor, indicScriptFixer, tokensToWords, wordsToPhrases } from "./transcribe-core.mjs";

const require = createRequire(import.meta.url);
const RATE = 16000;
const VAD_WINDOW = 512;

/** Print a progress line at most every 400 ms (and always at the end). */
function reporter(kind) {
  let last = 0;
  return (value) => {
    const now = Date.now();
    if (now - last < 400 && value < 1) return;
    last = now;
    console.log(`${kind} ${Math.min(1, value).toFixed(3)}`);
  };
}

/** Samples of the 16-bit PCM file from byte `offset`, at most `bytes` long. */
function readSamples(fd, offset, bytes) {
  const buf = Buffer.alloc(bytes);
  const n = readSync(fd, buf, 0, bytes, offset);
  const samples = new Float32Array(Math.floor(Math.max(0, n) / 2));
  for (let k = 0; k < samples.length; k++) samples[k] = buf.readInt16LE(k * 2) / 32768;
  return samples;
}

/** Speech parts of up to 20 s; a pause of 0.4 s ends a part. */
const newVad = (sherpa, vadModel) =>
  new sherpa.Vad(
    { sileroVad: { model: vadModel, threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.4, maxSpeechDuration: 20, windowSize: VAD_WINDOW }, sampleRate: RATE, debug: 0, numThreads: 1 },
    60,
  );

/**
 * The spoken language: Whisper's guess on up to 29 s of speech from each of three points
 * of the video (so a music intro or an ad in another language doesn't decide it), by vote.
 */
function detectLanguage(sherpa, job, fd, total) {
  const m = modelFiles(job.modelsDir, "lid");
  const lid = new sherpa.SpokenLanguageIdentification({ whisper: { encoder: m.encoder, decoder: m.decoder }, numThreads: job.threads ?? 2, debug: 0 });
  const votes = new Map();
  for (const at of [0.1, 0.45, 0.8]) {
    const vad = newVad(sherpa, m.vad);
    const start = Math.floor((total * at) / 2) * 2;
    const samples = readSamples(fd, start, Math.min(total - start, 180 * RATE * 2));
    const speech = [];
    let have = 0;
    for (let k = 0; k + VAD_WINDOW <= samples.length && have < 29 * RATE; k += VAD_WINDOW) {
      vad.acceptWaveform(samples.subarray(k, k + VAD_WINDOW));
      while (!vad.isEmpty()) {
        speech.push(vad.front().samples);
        have += speech.at(-1).length;
        vad.pop();
      }
    }
    if (have < 3 * RATE) continue;
    const joined = new Float32Array(Math.min(have, 29 * RATE));
    let o = 0;
    for (const part of speech) {
      if (o >= joined.length) break;
      joined.set(part.subarray(0, joined.length - o), o);
      o += Math.min(part.length, joined.length - o);
    }
    const stream = lid.createStream();
    stream.acceptWaveform({ sampleRate: RATE, samples: joined });
    const lang = lid.compute(stream);
    if (lang) votes.set(lang, (votes.get(lang) ?? 0) + have);
  }
  // No speech found anywhere: English, the model that needs no extra download.
  const best = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "en";
  // Whisper calls Javanese "jw"; its ISO 639-1 code is "jv".
  return best === "jw" ? "jv" : best;
}

function recognizerFor(sherpa, job, key) {
  const m = modelFiles(job.modelsDir, key);
  const common = { tokens: m.tokens, numThreads: job.threads ?? 2, provider: "cpu", debug: 0 };
  const modelConfig =
    MODELS[key].kind === "omnilingual"
      ? { omnilingual: { model: m.model }, ...common }
      : { transducer: { encoder: m.encoder, decoder: m.decoder, joiner: m.joiner }, modelType: "nemo_transducer", ...common };
  return new sherpa.OfflineRecognizer({ featConfig: { sampleRate: RATE, featureDim: 80 }, modelConfig, decodingMethod: "greedy_search" });
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--prefetch") {
    const choice = modelChoice(args[2]);
    const keys = args[3] === "english" ? [modelKey("english", choice)] : [modelKey("english", choice), "european", modelKey("omni", choice), "lid"];
    await ensureModels(args[1] ?? ".models", keys, reporter("DOWNLOAD"));
    console.log("READY");
    return;
  }

  const job = JSON.parse(readFileSync(args[0] ?? "", "utf8"));
  const choice = modelChoice(job.model);
  const sherpa = require("sherpa-onnx-node");
  const fd = openSync(job.pcm, "r");
  const total = statSync(job.pcm).size;

  let language = String(job.language ?? "auto");
  if (language === "auto" || language === "other" || !language) {
    await ensureModels(job.modelsDir, ["lid"], reporter("DOWNLOAD"));
    language = detectLanguage(sherpa, job, fd, total);
  }
  console.log(`LANGUAGE ${language}`);

  const engine = engineFor(language);
  const key = modelKey(engine, choice);
  await ensureModels(job.modelsDir, [key], reporter("DOWNLOAD"));
  const recognizer = recognizerFor(sherpa, job, key);
  const vad = newVad(sherpa, modelFiles(job.modelsDir, key).vad);

  /** @type {{ text: string, start: number, end: number }[]} */
  const words = [];
  const decodeReady = () => {
    while (!vad.isEmpty()) {
      const seg = vad.front();
      vad.pop();
      const start = seg.start / RATE;
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate: RATE, samples: seg.samples });
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      words.push(...tokensToWords(result.tokens ?? [], result.timestamps ?? [], start, start + seg.samples.length / RATE, language));
    }
  };

  const progress = reporter("PROGRESS");
  const chunk = VAD_WINDOW * 2 * 256; // 256 VAD windows, about 8 s
  for (let offset = 0; offset < total; offset += chunk) {
    const samples = readSamples(fd, offset, chunk);
    if (samples.length === 0) break;
    for (let k = 0; k < samples.length; k += VAD_WINDOW) vad.acceptWaveform(samples.subarray(k, Math.min(samples.length, k + VAD_WINDOW)));
    decodeReady();
    progress(Math.min(1, (offset + chunk) / total));
  }
  closeSync(fd);
  vad.flush();
  decodeReady();
  progress(1);

  if (engine === "omni") {
    const fix = indicScriptFixer(words.map((w) => w.text), language);
    for (const w of words) w.text = fix(w.text);
  }
  words.sort((a, b) => a.start - b.start);
  writeFileSync(job.out, JSON.stringify({ language, segments: wordsToPhrases(words) }));
}

main().catch((err) => {
  console.error(`TRANSCRIBE_ERROR ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
