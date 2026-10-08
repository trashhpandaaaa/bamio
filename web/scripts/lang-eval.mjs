/*
 * How well does Bamio transcribe each language? For every language asked for: find a YouTube
 * video spoken in it that has captions, take two minutes from it, run Bamio's own
 * transcriber (workers/transcribe.mjs) with the language left to detect, and compare:
 *   - the language it detected with the one expected;
 *   - the script it wrote in with the language's own;
 *   - its letters with the captions' (agreement: 100% is letter for letter).
 * Captions written by a person are the better yardstick ("manual"); YouTube's automatic ones
 * ("auto") still show a wrong language, a wrong script or a transcript that falls apart.
 *
 *   node scripts/lang-eval.mjs                 every language in the list
 *   node scripts/lang-eval.mjs hi ne bn        only these
 *   node scripts/lang-eval.mjs --sec 180       more of each video (default 120 s)
 *   node scripts/lang-eval.mjs --fresh hi      find a video and transcribe again (else kept results are reused)
 *   node scripts/lang-eval.mjs --again hi      transcribe the same video again (after changing the transcriber)
 *   node scripts/lang-eval.mjs --pick hi       also with the language picked instead of detected
 *   node scripts/lang-eval.mjs --engine omni el   with another model than the language's own ("english", "european", "omni")
 *
 * Run from web/ (the speech engine loads relative to it). Needs internet, yt-dlp and the speech
 * models (npm run setup:media). Work and results go to qa/lang-eval/ (not in git).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { engineFor, scriptOfLanguage, scriptShare } from "../workers/transcribe-core.mjs";

const require = createRequire(import.meta.url);
const ffmpeg = require("ffmpeg-static");
const ytdlp = path.join(process.cwd(), ".bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const OUT = path.join(process.cwd(), "qa", "lang-eval");

/** code, English name, and searches likely to find people talking in it (in its own words). `accept`: other codes that are right too. */
const LANGUAGES = [
  ["en", "English", ["podcast interview full episode"]],
  ["es", "Spanish", ["Easy Spanish entrevistas en la calle", "entrevista en español"]],
  ["pt", "Portuguese", ["Easy Portuguese entrevistas", "entrevista em português"]],
  ["fr", "French", ["Easy French micro-trottoir", "interview en français"]],
  ["de", "German", ["Easy German Straßeninterview", "Interview auf Deutsch"]],
  ["it", "Italian", ["Easy Italian interviste", "intervista in italiano"]],
  ["ru", "Russian", ["Easy Russian интервью", "интервью на русском"]],
  ["pl", "Polish", ["Easy Polish wywiad", "wywiad po polsku"]],
  ["nl", "Dutch", ["Easy Dutch interview", "interview in het Nederlands"]],
  ["uk", "Ukrainian", ["Easy Ukrainian", "інтерв'ю українською мовою"]],
  ["el", "Greek", ["Easy Greek συνέντευξη", "συνέντευξη στα ελληνικά"]],
  ["sv", "Swedish", ["Easy Swedish intervju", "intervju på svenska"]],
  ["ro", "Romanian", ["Easy Romanian interviu", "interviu în limba română"]],
  ["cs", "Czech", ["Easy Czech rozhovor", "rozhovor v češtině"]],
  ["hu", "Hungarian", ["Easy Hungarian interjú", "interjú magyarul"]],
  ["fi", "Finnish", ["Easy Finnish haastattelu", "haastattelu suomeksi"]],
  ["da", "Danish", ["Easy Danish interview", "interview på dansk"]],
  ["bg", "Bulgarian", ["Easy Bulgarian интервю", "интервю на български"]],
  ["hr", "Croatian", ["Easy Croatian intervju", "intervju na hrvatskom"], ["bs", "sr"]],
  ["hi", "Hindi", ["Easy Hindi इंटरव्यू", "हिंदी में इंटरव्यू"]],
  ["ja", "Japanese", ["Easy Japanese インタビュー", "日本語 インタビュー"]],
  ["ar", "Arabic", ["Easy Arabic مقابلة", "مقابلة باللغة العربية"]],
  ["ko", "Korean", ["Easy Korean 인터뷰", "한국어 인터뷰"]],
  ["id", "Indonesian", ["Easy Indonesian wawancara", "wawancara bahasa Indonesia"], ["ms"]],
  ["tr", "Turkish", ["Easy Turkish röportaj", "Türkçe röportaj"]],
  ["vi", "Vietnamese", ["Easy Vietnamese phỏng vấn", "phỏng vấn tiếng Việt"]],
  ["zh", "Chinese", ["Easy Mandarin 街头采访", "中文 采访"]],
  ["th", "Thai", ["Easy Thai สัมภาษณ์", "สัมภาษณ์ ภาษาไทย"]],
  ["tl", "Tagalog", ["Easy Tagalog panayam", "panayam sa Tagalog"]],
  ["ur", "Urdu", ["اردو انٹرویو", "Easy Urdu"]],
  ["fa", "Persian", ["Easy Persian مصاحبه", "مصاحبه فارسی"]],
  ["ta", "Tamil", ["தமிழ் பேட்டி", "Tamil interview தமிழ்"]],
  ["te", "Telugu", ["తెలుగు ఇంటర్వ్యూ", "Telugu interview తెలుగు"]],
  ["mr", "Marathi", ["मराठी मुलाखत", "Marathi interview मराठी"]],
  ["pa", "Punjabi", ["ਪੰਜਾਬੀ ਇੰਟਰਵਿਊ", "Punjabi interview ਪੰਜਾਬੀ"]],
  ["bn", "Bengali", ["বাংলা সাক্ষাৎকার", "Bangla interview বাংলা"]],
  ["ne", "Nepali", ["नेपाली अन्तर्वार्ता", "Nepali podcast नेपाली"]],
  ["sw", "Swahili", ["Easy Swahili mahojiano", "mahojiano kwa Kiswahili"]],
  ["he", "Hebrew", ["Easy Hebrew ראיון", "ראיון בעברית"]],
  ["ms", "Malay", ["temu bual bahasa Melayu", "wawancara Bahasa Melayu Malaysia"], ["id"]],
  ["no", "Norwegian", ["Easy Norwegian intervju", "intervju på norsk"], ["nn", "nb"]],
  ["ca", "Catalan", ["Easy Catalan entrevista", "entrevista en català"]],
  ["sr", "Serbian", ["Easy Serbian intervju", "intervju na srpskom"], ["hr", "bs"]],
  ["yue", "Cantonese", ["Easy Cantonese 街訪", "廣東話 訪問"], ["zh"]],
].map(([code, name, queries, accept = []]) => ({ code, name, queries, accept }));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const SEC = Number(args[args.indexOf("--sec") + 1]) > 0 && args.includes("--sec") ? Number(args[args.indexOf("--sec") + 1]) : 120;
const ENGINE = args.includes("--engine") ? args[args.indexOf("--engine") + 1] : undefined;
const wanted = args.filter((a, i) => !a.startsWith("--") && !/^\d+$/.test(a) && args[i - 1] !== "--engine");
/** The script each language is written in, where the transcriber's own table (the multilingual model's languages) doesn't say. */
const SCRIPT = { ru: "Cyrillic", uk: "Cyrillic", bg: "Cyrillic", sr: "Cyrillic", el: "Greek" };
const todo = LANGUAGES.filter((l) => wanted.length === 0 || wanted.includes(l.code));

/** Run a tool; resolves with its output (never throws: `code` says how it went). */
function run(cmd, cmdArgs, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, cmdArgs, { cwd: process.cwd(), env: { ...process.env, ...opts.env }, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-4000)));
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 180_000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err) });
    });
  });
}

const yt = (extra, timeoutMs) => run(ytdlp, ["--no-warnings", "--ignore-config", "--js-runtimes", `node:${process.execPath}`, ...extra], { timeoutMs });
const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** The caption track for a language: one a person wrote, else YouTube's own for the original speech. */
function captionTrack(info, lang) {
  const keyOf = (tracks) => Object.keys(tracks ?? {}).find((k) => k.toLowerCase().split("-")[0] === lang && !k.includes("live_chat"));
  const manual = keyOf(info.subtitles);
  if (manual) return { key: manual, kind: "manual" };
  const auto = Object.keys(info.automatic_captions ?? {}).find((k) => k === `${lang}-orig`) ?? (String(info.language ?? "").split("-")[0] === lang ? keyOf(info.automatic_captions) : undefined);
  return auto ? { key: auto, kind: "auto" } : null;
}

/** A video spoken in the language, 5 to 60 minutes long, with captions in it. */
async function findVideo(lang) {
  for (const query of lang.queries) {
    const found = json((await yt(["--flat-playlist", "-J", `ytsearch8:${query}`], 90_000)).stdout);
    for (const entry of found?.entries ?? []) {
      if (!entry?.id || !(entry.duration >= 300 && entry.duration <= 3600)) continue;
      const info = json((await yt(["--no-playlist", "-J", "--skip-download", "--", `https://www.youtube.com/watch?v=${entry.id}`], 90_000)).stdout);
      if (!info || info.is_live) continue;
      const spoken = String(info.language ?? "").toLowerCase().split("-")[0];
      // YouTube names the spoken language for most videos: when it does, it must be this one (or a close relative).
      if (spoken && spoken !== lang.code && !lang.accept.includes(spoken)) continue;
      const track = captionTrack(info, lang.code);
      if (!track && !spoken) continue;
      return { id: info.id, title: info.title, channel: info.channel, duration: info.duration, spoken, track };
    }
  }
  return null;
}

/** The captions' words between two times, from YouTube's json3 format. */
function captionText(file, from, to) {
  const data = json(readFileSync(file, "utf8"));
  const parts = [];
  for (const event of data?.events ?? []) {
    const at = (event.tStartMs ?? 0) / 1000;
    if (at < from || at >= to || !event.segs) continue;
    parts.push(event.segs.map((s) => s.utf8 ?? "").join(""));
  }
  // Sounds and speakers in brackets aren't speech.
  return parts.join(" ").replace(/\[[^\]]*\]|\([^)]*\)|（[^）]*）|♪/g, " ").replace(/\s+/g, " ").trim();
}

const lettersOf = (text) => [...text.normalize("NFKC").toLowerCase()].filter((ch) => /[\p{L}\p{M}\p{N}]/u.test(ch));

/** Serbian is written in Cyrillic and in Latin letters, one for one: the transcript comes in Cyrillic, most captions in Latin. */
const SERBIAN_LATIN = { а: "a", б: "b", в: "v", г: "g", д: "d", ђ: "đ", е: "e", ж: "ž", з: "z", и: "i", ј: "j", к: "k", л: "l", љ: "lj", м: "m", н: "n", њ: "nj", о: "o", п: "p", р: "r", с: "s", т: "t", ћ: "ć", у: "u", ф: "f", х: "h", ц: "c", ч: "č", џ: "dž", ш: "š" };
const serbianLatin = (text) => [...text.toLowerCase()].map((ch) => SERBIAN_LATIN[ch] ?? ch).join("");
/** The transcript in the captions' script, where a language has two (so the letters can be compared). */
const inScriptOf = (text, reference, code) => (code === "sr" && scriptShare(reference, "Latin") > 0.5 ? serbianLatin(text) : text);

/** Share of letters that agree: 1 minus the edits needed to turn one into the other, over the longer. */
function agreement(a, b) {
  const x = lettersOf(a);
  const y = lettersOf(b);
  if (x.length === 0 || y.length === 0) return 0;
  let prev = new Uint32Array(y.length + 1).map((_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const row = new Uint32Array(y.length + 1);
    row[0] = i;
    for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = row;
  }
  return 1 - prev[y.length] / Math.max(x.length, y.length);
}

async function transcribe(dir, language) {
  const name = ENGINE ? `${language}-${ENGINE}` : language;
  const out = path.join(dir, `out-${name}.json`);
  const job = path.join(dir, `job-${name}.json`);
  rmSync(out, { force: true });
  writeFileSync(job, JSON.stringify({ pcm: path.join(dir, "audio.s16"), modelsDir: path.join(process.cwd(), ".models"), language, model: process.env.BAMIO_SPEECH_MODEL, engine: ENGINE, threads: 2, parallel: 2, out }));
  const started = Date.now();
  const ran = await run(process.execPath, [path.join("workers", "transcribe.mjs"), job], { timeoutMs: 30 * 60_000, env: { UV_THREADPOOL_SIZE: "4" } });
  const result = existsSync(out) ? json(readFileSync(out, "utf8")) : null;
  if (!result) return { error: (ran.stderr || ran.stdout).split("\n").filter(Boolean).at(-1)?.slice(0, 200) ?? "no output" };
  const text = result.segments.map((s) => s.text).join(" ");
  return { language: result.language, firstGuess: /^LANGUAGE (\S+)/m.exec(ran.stdout)?.[1], text, words: result.segments.reduce((n, s) => n + (s.words?.length ?? 0), 0), tookSec: (Date.now() - started) / 1000 };
}

async function evaluate(lang) {
  const dir = path.join(OUT, lang.code);
  const kept = path.join(dir, "result.json");
  if (!flag("--fresh") && !flag("--pick") && !flag("--again") && !ENGINE && existsSync(kept)) return json(readFileSync(kept, "utf8"));
  if (flag("--fresh")) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const videoFile = path.join(dir, "video.json");
  const video = existsSync(videoFile) ? json(readFileSync(videoFile, "utf8")) : await findVideo(lang);
  if (!video) return { code: lang.code, name: lang.name, problem: "no video found with captions in this language" };
  writeFileSync(videoFile, JSON.stringify(video, null, 2));
  const url = `https://www.youtube.com/watch?v=${video.id}`;
  const from = Math.floor(Math.min(120, video.duration / 3));
  const to = from + SEC;

  if (!existsSync(path.join(dir, "audio.s16"))) {
    for (const f of readdirSync(dir)) if (f.startsWith("audio.")) rmSync(path.join(dir, f));
    const got = await yt(["--no-playlist", "-f", "bestaudio/best", "--download-sections", `*${from}-${to}`, "--ffmpeg-location", ffmpeg, "-o", path.join(dir, "audio.%(ext)s"), "--", url], 300_000);
    const file = readdirSync(dir).find((f) => f.startsWith("audio.") && !f.endsWith(".part"));
    if (!file) return { code: lang.code, name: lang.name, url, problem: `couldn't download the audio: ${got.stderr.split("\n").filter(Boolean).at(-1)?.slice(0, 160)}` };
    await run(ffmpeg, ["-hide_banner", "-nostdin", "-y", "-i", path.join(dir, file), "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-af", "aresample=async=1:first_pts=0", "-f", "s16le", path.join(dir, "audio.s16")]);
  }

  let reference = "";
  if (video.track) {
    if (!readdirSync(dir).some((f) => f.endsWith(".json3"))) {
      await yt(["--no-playlist", "--skip-download", video.track.kind === "manual" ? "--write-subs" : "--write-auto-subs", "--sub-langs", video.track.key, "--sub-format", "json3", "-o", path.join(dir, "captions"), "--", url], 120_000);
    }
    const file = readdirSync(dir).find((f) => f.endsWith(".json3"));
    // The section was cut to start at `from`, so the transcript's 0 is the video's `from`.
    if (file) reference = captionText(path.join(dir, file), from, to);
  }

  // Another model than the language's own is tried with the language given (detection isn't what's being measured).
  const heard = await transcribe(dir, ENGINE ? lang.code : "auto");
  if (heard.error) return { code: lang.code, name: lang.name, url, problem: `transcriber: ${heard.error}` };
  const script = scriptOfLanguage(lang.code) ?? SCRIPT[lang.code] ?? "Latin";
  const result = {
    code: lang.code,
    name: lang.name,
    url,
    title: String(video.title).slice(0, 70),
    reference: reference ? video.track.kind : "none",
    detected: heard.language,
    firstGuess: heard.firstGuess,
    rightLanguage: heard.language === lang.code || lang.accept.includes(heard.language),
    engine: ENGINE ?? engineFor(heard.language),
    script,
    scriptShare: Number(scriptShare(heard.text, script).toFixed(3)),
    agreement: reference ? Number(agreement(inScriptOf(heard.text, reference, lang.code), reference).toFixed(3)) : null,
    words: heard.words,
    speed: Number((SEC / heard.tookSec).toFixed(1)),
    sample: heard.text.slice(0, 160),
    referenceSample: reference.slice(0, 160),
  };
  // With the language picked by hand, as the import form's picker would: what the right language is worth.
  if (flag("--pick") || !result.rightLanguage) {
    const picked = await transcribe(dir, lang.code);
    if (!picked.error) {
      result.picked = { agreement: reference ? Number(agreement(inScriptOf(picked.text, reference, lang.code), reference).toFixed(3)) : null, scriptShare: Number(scriptShare(picked.text, script).toFixed(3)), sample: picked.text.slice(0, 160) };
    }
  }
  if (!ENGINE) writeFileSync(kept, JSON.stringify(result, null, 2));
  return result;
}

const pct = (v) => (v === null || v === undefined ? "  -" : `${Math.round(v * 100)}%`.padStart(4));
const results = [];
for (const lang of todo) {
  const r = await evaluate(lang).catch((err) => ({ code: lang.code, name: lang.name, problem: String(err).slice(0, 200) }));
  results.push(r);
  if (r.problem) console.log(`${r.code.padEnd(4)} ${r.name.padEnd(11)} ${r.problem}`);
  else {
    console.log(
      `${r.code.padEnd(4)} ${r.name.padEnd(11)} heard ${String(r.detected).padEnd(4)}${r.rightLanguage ? "  " : " X"} ${r.engine.padEnd(8)} agrees ${pct(r.agreement)} (${r.reference.padEnd(6)}) script ${pct(r.scriptShare)} ${String(r.speed).padStart(5)}x` +
        (r.picked ? `  | picked: agrees ${pct(r.picked.agreement)} script ${pct(r.picked.scriptShare)}` : ""),
    );
  }
}
mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
const bad = results.filter((r) => r.problem || !r.rightLanguage || r.scriptShare < 0.9 || (r.agreement !== null && r.agreement < 0.7));
console.log(`\n${results.length} languages, ${bad.length} to look at${bad.length ? `: ${bad.map((r) => r.code).join(", ")}` : ""}. Details: qa/lang-eval/results.json`);
