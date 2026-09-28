/*
 * On-device transcription with word timing. Run by the server as a separate Node process
 * (the model is CPU-heavy and would otherwise stall the web server):
 *
 *   node workers/transcribe.mjs <job.json>          transcribe, write job.out
 *   node workers/transcribe.mjs --prefetch <dir>    download the models into <dir>
 *
 * job.json: { pcm, modelsDir, threads, out }; pcm is raw 16 kHz mono signed 16-bit audio.
 * Silero VAD finds the speech; Parakeet TDT (via sherpa-onnx) transcribes each part and
 * gives every token a time. Prints "DOWNLOAD <0..1>" while fetching the models the first
 * time and "PROGRESS <0..1>" while transcribing; writes { language, segments } to job.out.
 */
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ensureModels, modelPaths } from "./speech-models.mjs";
import { tokensToWords, wordsToPhrases } from "./transcribe-core.mjs";

const require = createRequire(import.meta.url);
const RATE = 16000;

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

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--prefetch") {
    await ensureModels(args[1] ?? ".models", reporter("DOWNLOAD"));
    console.log("READY");
    return;
  }

  const job = JSON.parse(readFileSync(args[0] ?? "", "utf8"));
  await ensureModels(job.modelsDir, reporter("DOWNLOAD"));
  const sherpa = require("sherpa-onnx-node");
  const m = modelPaths(job.modelsDir);
  const recognizer = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: RATE, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: m.encoder, decoder: m.decoder, joiner: m.joiner },
      tokens: m.tokens,
      modelType: "nemo_transducer",
      numThreads: job.threads ?? 2,
      provider: "cpu",
      debug: 0,
    },
    decodingMethod: "greedy_search",
  });
  // Speech parts of up to 20 s; a pause of 0.4 s ends a part.
  const vad = new sherpa.Vad(
    { sileroVad: { model: m.vad, threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.4, maxSpeechDuration: 20, windowSize: 512 }, sampleRate: RATE, debug: 0, numThreads: 1 },
    60,
  );

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
      words.push(...tokensToWords(result.tokens ?? [], result.timestamps ?? [], start, start + seg.samples.length / RATE));
    }
  };

  const progress = reporter("PROGRESS");
  const fd = openSync(job.pcm, "r");
  const total = statSync(job.pcm).size;
  const buf = Buffer.alloc(512 * 2 * 256); // 256 VAD windows, about 8 s
  let offset = 0;
  while (offset < total) {
    const n = readSync(fd, buf, 0, buf.length, offset);
    if (n <= 0) break;
    offset += n;
    const samples = new Float32Array(Math.floor(n / 2));
    for (let k = 0; k < samples.length; k++) samples[k] = buf.readInt16LE(k * 2) / 32768;
    for (let k = 0; k < samples.length; k += 512) vad.acceptWaveform(samples.subarray(k, Math.min(samples.length, k + 512)));
    decodeReady();
    progress(offset / total);
  }
  closeSync(fd);
  vad.flush();
  decodeReady();
  progress(1);

  words.sort((a, b) => a.start - b.start);
  writeFileSync(job.out, JSON.stringify({ language: "en", segments: wordsToPhrases(words) }));
}

main().catch((err) => {
  console.error(`TRANSCRIBE_ERROR ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
