/*
 * On-device transcription with word timing, in any language. Run by the server as a
 * separate Node process (the models are CPU-heavy and would otherwise stall the web server):
 *
 *   node workers/transcribe.mjs <job.json>                 transcribe, write job.out
 *   node workers/transcribe.mjs --detect <job.json>        name the language, carefully (run by itself, see below)
 *   node workers/transcribe.mjs --prefetch <dir> [accurate|fast] [all|english]
 *                                                          download the models into <dir>
 *
 * job.json: { pcm, modelsDir, language, model, threads, parallel, out }. pcm is raw 16 kHz mono
 * signed 16-bit audio; language is a code such as "hi", or "auto" to detect it; model is
 * "accurate" (default) or "fast" (see speech-models.mjs); `parallel` speech parts are decoded
 * at once with `threads` threads each (set UV_THREADPOOL_SIZE above `parallel`). `engine`
 * ("english", "european" or "omni") overrides the model the language would get: for
 * measuring one against another (scripts/lang-eval.mjs).
 *
 * Whisper detects the language from speech at five points of the video (unless it was given):
 * tiny first, and when it hears anything but English at every point, small listens again in a
 * process of its own (it's better at telling close relatives apart, and its memory is gone
 * before the transcription model loads). Silero VAD finds the speech (a part it couldn't end
 * within 20 s, under music or a crowd, is cut at its quietest moments: the models garble longer
 * ones), and the language's model (Parakeet for English and 23 European languages, Omnilingual
 * ASR for the rest) transcribes each part and gives every token a time. Then the repairs:
 *  - Omnilingual's transcript where speakers switch languages (English checked against the
 *    English model, stretches in the wrong script decoded again; see repairMultilingual), and
 *    a video that turns out to be mostly English is named English;
 *  - the European model's where it slipped into English on speech that isn't (see
 *    repairEuropean): those stretches are heard again by Omnilingual.
 * Prints "LANGUAGE <code>" once known (again if the transcript names it better),
 * "DOWNLOAD <0..1>" while fetching models the first time and "PROGRESS <0..1>" while
 * transcribing; writes { language, segments } to job.out.
 */
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { ensureModels, MODELS, modelChoice, modelFiles, modelKey } from "./speech-models.mjs";
import {
  asSentence,
  engineFor,
  engineForWindows,
  englishSpans,
  englishStretches,
  indicScriptFixer,
  languageForScript,
  mainScript,
  preferOtherReading,
  scriptOfLanguage,
  scriptShare,
  splitLongSpeech,
  tokensToWords,
  wordAgreement,
  wordsToPhrases,
} from "./transcribe-core.mjs";

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

/** The longest stretch a model is given at once: longer ones are cut at their quietest moments (splitLongSpeech). */
const MAX_PART = 20 * RATE;

/** Speech parts of about 20 s at most (when there's a pause to end on); a pause of 0.4 s ends a part. */
const newVad = (sherpa, vadModel) =>
  new sherpa.Vad(
    { sileroVad: { model: vadModel, threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.4, maxSpeechDuration: 20, windowSize: VAD_WINDOW }, sampleRate: RATE, debug: 0, numThreads: 1 },
    60,
  );

/**
 * The language heard at five points of the video (Whisper on up to 29 s of speech each),
 * with the seconds of speech behind each guess. Several points, so a music intro or an ad
 * doesn't decide it, and a mix of languages shows (see engineForWindows). `key`: "lid"
 * (Whisper tiny) or "lid-accurate" (small).
 */
function detectLanguages(sherpa, job, fd, total, key = "lid") {
  const m = modelFiles(job.modelsDir, key);
  const lid = new sherpa.SpokenLanguageIdentification({ whisper: { encoder: m.encoder, decoder: m.decoder }, numThreads: job.threads ?? 2, debug: 0 });
  const windows = [];
  for (const at of [0.1, 0.3, 0.5, 0.7, 0.9]) {
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
    // Whisper calls Javanese "jw"; its ISO 639-1 code is "jv".
    if (lang) windows.push({ lang: lang === "jw" ? "jv" : lang, weight: have / RATE });
  }
  return windows;
}

/**
 * The same five points heard by Whisper small, in a process of its own: its gigabyte of memory
 * is given back before the transcription model loads (in this process it would stay until
 * garbage collection got round to it). Null when it can't run (offline before its first
 * download, out of memory): the first detection then stands. Its stdin is a pipe from here that
 * nothing is written to: when this process is killed (a cancelled job) the pipe closes, and it
 * stops too instead of downloading on alone.
 */
function detectCarefully(jobPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--detect", jobPath], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    const timer = setTimeout(() => child.kill(), 30 * 60_000);
    let buffer = "";
    let windows = null;
    child.stdout.on("data", (data) => {
      buffer += data;
      for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("DOWNLOAD ")) console.log(line);
        if (line.startsWith("WINDOWS ")) {
          try {
            windows = JSON.parse(line.slice(8));
          } catch {
            windows = null;
          }
        }
      }
    });
    const done = (result) => {
      clearTimeout(timer);
      resolve(result);
    };
    child.on("close", (code) => done(code === 0 && Array.isArray(windows) ? windows : null));
    child.on("error", () => done(null));
  });
}

/** Run `work` on every item, `limit` at a time. */
async function eachLimited(items, limit, work) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** English check: the share of words the English model must agree on for a stretch to be English (the lower one when decoding it again didn't give the language). */
const ENGLISH_AGREES = 0.5;
const ENGLISH_LIKELY = 0.3;
/**
 * Up to this much of the video's own speech is decoded before a stretch to keep the model in
 * its language (after it only when there's none before: context on both sides did worse).
 */
const CONTEXT = 8 * RATE;

/**
 * A multilingual transcript (segments in time order, their `words` replaced in place),
 * fixed up stretch by stretch where speakers switch languages. The script of the language
 * decides (Devanagari for Nepali, however much English the video has):
 *  - a stretch with Latin letters is transcribed by the English model too, and is English
 *    where the two agree: all of it, or runs of 3+ words inside a sentence of both;
 *  - a stretch not in the language's script (it spelled in Latin letters, or another script
 *    altogether) is decoded again after a few seconds of the video's own speech in that
 *    script from just before it, which keeps the model in the language;
 *  - stray letters of neighbouring Indian scripts are mapped back.
 * For a language written in Latin letters only the English check runs, and only if English
 * was heard (`checkEnglish`). Returns the language to report: with `relabel` (detected, not
 * chosen) it's named from the transcript's common words.
 */
async function repairMultilingual({ sherpa, job, choice, omni, segments, fd, language, relabel, checkEnglish, onProgress }) {
  const texts = segments.map((s) => s.text);
  const main = mainScript(texts);
  const label = relabel ? languageForScript(language, main, texts) : language;
  const script = (relabel ? null : scriptOfLanguage(label, main)) ?? main;
  const latinScript = script === "Latin";
  if (!script || script === "Other" || (latinScript && !checkEnglish)) return label;

  const read = (start, length) => readSamples(fd, start * 2, length * 2);
  const decode = async (rec, samples) => {
    const stream = rec.createStream();
    stream.acceptWaveform({ sampleRate: RATE, samples });
    return rec.decodeAsync(stream);
  };
  const wordsOf = (r, seg, locale, tokens = r.tokens ?? [], times = r.timestamps ?? []) =>
    tokensToWords(tokens, times, seg.start / RATE, (seg.start + seg.length) / RATE, locale);
  const inScript = (words) => scriptShare(words.map((w) => w.text).join(" "), script);
  const good = segments.map((s) => s.length >= RATE && scriptShare(s.text, script) >= 0.8);

  /** Up to `limit` samples of speech in the language's script next to `segments[i]` (dir -1: before it, 1: after it), within a minute. */
  const contextFor = (i, dir, limit) => {
    const parts = [];
    let have = 0;
    for (let k = i + dir; k >= 0 && k < segments.length && have < limit && Math.abs(segments[k].start - segments[i].start) < 60 * RATE; k += dir) {
      if (!good[k]) continue;
      const take = Math.min(segments[k].length, limit - have);
      parts.push({ start: dir < 0 ? segments[k].start + segments[k].length - take : segments[k].start, length: take });
      have += take;
    }
    return { parts: dir < 0 ? parts.reverse() : parts, have };
  };

  /** `segments[i]` decoded after (or before) speech in the language's script from next to it, keeping only its own words (null without any). */
  const primed = async (i) => {
    const seg = segments[i];
    let before = contextFor(i, -1, CONTEXT);
    let after = { parts: [], have: 0 };
    if (before.have < RATE) [before, after] = [after, contextFor(i, 1, CONTEXT)];
    if (before.have + after.have < RATE) return null;
    const gap = Math.round(0.3 * RATE);
    const pieces = [...before.parts, { start: seg.start, length: seg.length, own: true }, ...after.parts];
    const x = new Float32Array(pieces.reduce((n, p) => n + p.length + gap, 0));
    let at = 0;
    let offset = 0;
    for (const p of pieces) {
      if (p.own) offset = at;
      x.set(read(p.start, p.length), at);
      at += p.length + gap;
    }
    const r = await decode(omni, x);
    const from = offset / RATE;
    const own = seg.length / RATE;
    // The gaps are 0.3 s of silence, so a token up to 0.15 s into one still belongs to the segment.
    const kept = (r.tokens ?? []).map((t, k) => ({ t, at: (r.timestamps?.[k] ?? 0) - from })).filter((p) => p.at >= -0.15 && p.at < own + 0.15);
    return wordsOf(r, seg, label, kept.map((p) => p.t), kept.map((p) => Math.min(own, Math.max(0, p.at))));
  };

  const todo = segments.map((_, i) => i).filter((i) => /\p{L}/u.test(segments[i].text) && (latinScript || scriptShare(segments[i].text, script) < 0.7));
  const hasLatin = (i) => scriptShare(segments[i].text, "Latin") >= 0.3;
  /** Words that ended up as the English model's. */
  let englishCount = 0;
  let english = null;
  if (todo.some(hasLatin)) {
    const key = modelKey("english", choice);
    english = await ensureModels(job.modelsDir, [key], reporter("DOWNLOAD")).then(
      () => recognizerFor(sherpa, job, key),
      () => null, // offline: no English check
    );
  }

  let done = 0;
  await eachLimited(todo, Math.max(1, job.parallel ?? 1), async (i) => {
    const seg = segments[i];
    // Only a stretch with (almost) nothing in the language's script can be English throughout.
    const couldBeEnglish = latinScript || scriptShare(seg.text, script) < 0.2;
    let englishWords = [];
    let agreement = { ratio: 0, matched: [] };
    if (english && hasLatin(i)) {
      englishWords = wordsOf(await decode(english, read(seg.start, seg.length)), seg, "en");
      agreement = wordAgreement(seg.words.map((w) => w.text), englishWords.map((w) => w.text));
    }
    const spans = englishSpans(seg.words, agreement.matched);
    const within = (t) => spans.some((s) => t >= s.start - 0.05 && t <= s.end + 0.05);
    // A word that starts in an English run is (partly) that English, spelled in the language's script.
    const inSpan = (w) => within(w.start) || within((w.start + w.end) / 2);
    let words = seg.words;
    if (couldBeEnglish && agreement.ratio >= ENGLISH_AGREES) words = englishWords;
    else {
      const again = latinScript ? null : await primed(i);
      if (again && inScript(again.filter((w) => !inSpan(w))) >= 0.7) words = again;
      // Not the language even among its own speech (or none of it within a minute): English is the likelier.
      else if (couldBeEnglish && agreement.ratio >= ENGLISH_LIKELY) words = englishWords;
      if (words !== englishWords && spans.length > 0) {
        words = [...words.filter((w) => !inSpan(w)), ...englishWords.filter(inSpan)].sort((a, b) => a.start - b.start);
      }
    }
    seg.words = words;
    englishCount += words === englishWords ? words.length : spans.length > 0 ? englishWords.filter(inSpan).length : 0;
    onProgress(++done / todo.length);
  });

  if (!latinScript) {
    const fix = indicScriptFixer(segments.map((s) => s.words.map((w) => w.text).join(" ")), label);
    for (const s of segments) for (const w of s.words) w.text = fix(w.text);
  }
  // Mostly English after all (an accent or an advert misled the detection): name it so.
  const total = segments.reduce((n, s) => n + s.words.length, 0);
  if (relabel && total >= 20 && englishCount >= 0.75 * total) return "en";
  return label;
}

/**
 * A European (not English) transcript, fixed where the European model slipped into English:
 * it sometimes writes a stretch of, say, French as broken English ("And it's comment?" for
 * "Et c'était comment ?"), and more of the video's own speech before the stretch doesn't stop
 * it. Sentences that read as English (englishStretches) are heard again by Omnilingual (the
 * small one: it's only a second opinion, and has to fit in memory beside the European model),
 * which writes what was said in the language it was said in. Its reading replaces the stretch
 * when it isn't English (as a sentence: it comes lowercase, without punctuation); when it
 * hears English too, the speech is English and stays as it was.
 */
async function repairEuropean({ sherpa, job, segments, fd, language, parallel, onProgress }) {
  const stretches = segments.flatMap((seg) => englishStretches(seg.words).map((range) => ({ seg, ...range })));
  if (stretches.length === 0) return;
  const key = modelKey("omni", "fast");
  const other = await ensureModels(job.modelsDir, [key], reporter("DOWNLOAD")).then(
    () => recognizerFor(sherpa, job, key),
    () => null, // offline before its first download: the transcript stays as it is
  );
  if (!other) return;
  let done = 0;
  await eachLimited(stretches, parallel, async (stretch) => {
    const { seg } = stretch;
    const words = seg.words.slice(stretch.from, stretch.to);
    // From the word before it to the word after it (the part's edges without one): where the
    // model slipped it also left speech out, which the second listen brings back.
    const before = seg.words[stretch.from - 1];
    const after = seg.words[stretch.to];
    const start = before ? Math.max(seg.start, Math.round(before.end * RATE)) : seg.start;
    const end = after ? Math.min(seg.start + seg.length, Math.round(after.start * RATE)) : seg.start + seg.length;
    if (end - start >= RATE / 2) {
      const stream = other.createStream();
      stream.acceptWaveform({ sampleRate: RATE, samples: readSamples(fd, start * 2, (end - start) * 2) });
      const heard = await other.decodeAsync(stream);
      if (preferOtherReading(words.map((w) => w.text).join(" "), heard.text ?? "")) {
        stretch.words = asSentence(tokensToWords(heard.tokens ?? [], heard.timestamps ?? [], start / RATE, end / RATE, language), language);
      }
    }
    onProgress(++done / stretches.length);
  });
  // Last stretch first, so the earlier ones' places in the part still hold.
  for (const stretch of stretches.reverse()) if (stretch.words) stretch.seg.words.splice(stretch.from, stretch.to - stretch.from, ...stretch.words);
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
    const careful = choice === "accurate" ? ["lid-accurate", modelKey("omni", "fast")] : [];
    const keys = args[3] === "english" ? [modelKey("english", choice)] : [...new Set([modelKey("english", choice), "european", modelKey("omni", choice), "lid", ...careful])];
    await ensureModels(args[1] ?? ".models", keys, reporter("DOWNLOAD"));
    console.log("READY");
    return;
  }

  if (args[0] === "--detect") {
    // Started by detectCarefully: gone when its parent is.
    process.stdin.on("close", () => process.exit(1)).resume();
    const job = JSON.parse(readFileSync(args[1] ?? "", "utf8"));
    await ensureModels(job.modelsDir, ["lid-accurate"], reporter("DOWNLOAD"));
    const fd = openSync(job.pcm, "r");
    console.log(`WINDOWS ${JSON.stringify(detectLanguages(require("sherpa-onnx-node"), job, fd, statSync(job.pcm).size, "lid-accurate"))}`);
    closeSync(fd);
    process.stdin.pause();
    return;
  }

  const job = JSON.parse(readFileSync(args[0] ?? "", "utf8"));
  const choice = modelChoice(job.model);
  const sherpa = require("sherpa-onnx-node");
  const fd = openSync(job.pcm, "r");
  const total = statSync(job.pcm).size;

  let language = String(job.language ?? "auto");
  const auto = language === "auto" || language === "other" || !language;
  let engine = engineFor(language);
  let heardEnglish = false;
  if (auto) {
    await ensureModels(job.modelsDir, ["lid"], reporter("DOWNLOAD"));
    let windows = detectLanguages(sherpa, job, fd, total);
    // Anything but English at every point: Whisper small listens too, and decides (it tells close
    // relatives apart far better). English throughout needs no second listen.
    if (choice === "accurate" && windows.some((w) => w.lang !== "en")) windows = (await detectCarefully(args[0])) ?? windows;
    ({ engine, language } = engineForWindows(windows));
    heardEnglish = windows.some((w) => w.lang === "en");
  }
  if (["english", "european", "omni"].includes(job.engine)) engine = job.engine;
  console.log(`LANGUAGE ${language}`);

  const key = modelKey(engine, choice);
  await ensureModels(job.modelsDir, [key], reporter("DOWNLOAD"));
  const recognizer = recognizerFor(sherpa, job, key);
  const vad = newVad(sherpa, modelFiles(job.modelsDir, key).vad);

  /** Speech parts (start and length in samples) with the recognizer's text and words. */
  const segments = [];
  // Omnilingual's transcript is repaired afterwards (see repairMultilingual): the last 15% of the progress.
  // The European model's too, where it slipped into English (repairEuropean): the last 5%.
  const decodeShare = engine === "omni" ? 0.85 : engine === "european" && language !== "en" ? 0.95 : 1;
  // A detected language is named again from the first few hundred letters of transcript
  // (Whisper tiny once called Nepali "Malayalam"); the final name comes from all of it.
  let renamed = !auto || engine !== "omni";
  // Up to `parallel` speech parts decode at once (on libuv's pool, sharing the model) while
  // the VAD reads on: much faster than one part at a time with more threads.
  const parallel = Math.max(1, job.parallel ?? 1);
  const pending = new Set();
  const decodeOne = async (seg) => {
    const start = seg.start / RATE;
    const stream = recognizer.createStream();
    stream.acceptWaveform({ sampleRate: RATE, samples: seg.samples });
    const result = parallel > 1 ? await recognizer.decodeAsync(stream) : (recognizer.decode(stream), recognizer.getResult(stream));
    const words = tokensToWords(result.tokens ?? [], result.timestamps ?? [], start, start + seg.samples.length / RATE, language);
    segments.push({ start: seg.start, length: seg.samples.length, text: result.text ?? "", words });
    if (!renamed && segments.reduce((n, s) => n + s.text.length, 0) >= 600) {
      renamed = true;
      const texts = segments.map((s) => s.text);
      const early = languageForScript(language, mainScript(texts), texts);
      if (early !== language) console.log(`LANGUAGE ${early}`);
    }
  };
  const decodeReady = async () => {
    while (!vad.isEmpty()) {
      const speech = vad.front();
      vad.pop();
      // The VAD's 20 s is a wish, not a limit: with no pause to end on, a part can run to a minute.
      for (const piece of splitLongSpeech(speech.samples, MAX_PART, RATE)) {
        const seg = { start: speech.start + piece.start, samples: speech.samples.subarray(piece.start, piece.start + piece.length) };
        const task = decodeOne(seg).finally(() => pending.delete(task));
        pending.add(task);
        if (pending.size >= parallel) await Promise.race(pending);
      }
    }
  };

  const progress = reporter("PROGRESS");
  const chunk = VAD_WINDOW * 2 * 256; // 256 VAD windows, about 8 s
  for (let offset = 0; offset < total; offset += chunk) {
    const samples = readSamples(fd, offset, chunk);
    if (samples.length === 0) break;
    for (let k = 0; k < samples.length; k += VAD_WINDOW) vad.acceptWaveform(samples.subarray(k, Math.min(samples.length, k + VAD_WINDOW)));
    await decodeReady();
    progress(decodeShare * Math.min(1, (offset + chunk) / total));
  }
  vad.flush();
  await decodeReady();
  await Promise.all(pending);
  segments.sort((a, b) => a.start - b.start);

  if (engine === "omni") {
    progress(decodeShare);
    language = await repairMultilingual({
      sherpa,
      job,
      choice,
      omni: recognizer,
      segments,
      fd,
      language,
      relabel: auto,
      checkEnglish: heardEnglish,
      onProgress: (v) => progress(decodeShare + (1 - decodeShare) * v),
    });
  } else if (engine === "european" && language !== "en") {
    await repairEuropean({ sherpa, job, segments, fd, language, parallel, onProgress: (v) => progress(decodeShare + (1 - decodeShare) * v) });
  }
  closeSync(fd);
  progress(1);
  writeFileSync(job.out, JSON.stringify({ language, segments: wordsToPhrases(segments.flatMap((s) => s.words)) }));
}

main().catch((err) => {
  console.error(`TRANSCRIBE_ERROR ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
