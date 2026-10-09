#!/usr/bin/env node
/*
 * Checks that your Gemini key and the configured models work for Bamio:
 * JSON answers (clip finding) and audio input (transcription), on the main
 * model and on the fallback model.
 *   npm run ai:check
 * Reads web/.env and web/.env.local the same way Next.js does.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const root = fileURLToPath(new URL("..", import.meta.url));
nextEnv.loadEnvConfig(root);
const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const main = process.env.BAMIO_TEXT_MODEL || "gemini-3.8-flash";
const fallbackEnv = process.env.BAMIO_TEXT_FALLBACK_MODEL;
const fallback = fallbackEnv === undefined ? "gemini-3.5-flash-lite" : fallbackEnv === "" || fallbackEnv === "none" ? null : fallbackEnv;

if (!key) {
  console.error("✗ No GEMINI_API_KEY found. Add it to web/.env or web/.env.local (see .env.example).");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: key });
/** Google's own sentence: the SDK's error message is the JSON body of the answer. */
const googleSays = (err) => {
  const raw = String(err?.message ?? "");
  try {
    const said = JSON.parse(raw)?.error?.message;
    if (typeof said === "string") return said;
  } catch {
    // Not JSON: the message is the sentence.
  }
  return raw;
};
const explain = (err) => {
  const status = err?.status;
  if (status === 404) return "model not found. Set a valid model ID in web/.env.";
  // Not one cause (a key that may not use the model, a restricted key, a project Google has suspended): Google says which.
  if (status === 401 || status === 403) return `Google refused this key: "${googleSays(err).split(key).join("(the key)").slice(0, 240)}"`;
  if (status === 429) return "rate limited. Wait a minute and retry.";
  if (status === 503) return "model busy (high demand). Try again in a few minutes.";
  if (err?.name === "AbortError" || /timed? ?out/i.test(err?.message ?? "")) return "no answer within the time limit (network or Gemini slow).";
  if (status === 400 && /api key/i.test(err?.message ?? "")) return "the API key was rejected.";
  return err?.message ?? String(err);
};

async function check(name, model, run) {
  const started = Date.now();
  try {
    const detail = await run();
    console.log(`✓ ${name.padEnd(6)} ${model}  ${detail} (${Date.now() - started} ms)`);
    return true;
  } catch (err) {
    console.log(`✗ ${name.padEnd(6)} ${model}  ${explain(err)}`);
    return false;
  }
}

/** Three seconds of tone as MP3, made with the bundled ffmpeg. */
function sampleAudio() {
  const ffmpeg = path.join(root, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  if (!existsSync(ffmpeg)) return null;
  const out = path.join(tmpdir(), `bamio-ai-check-${process.pid}.mp3`);
  const res = spawnSync(ffmpeg, ["-hide_banner", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ac", "1", "-ar", "16000", "-b:a", "32k", out], { windowsHide: true });
  if (res.status !== 0) return null;
  const data = readFileSync(out).toString("base64");
  rmSync(out, { force: true });
  return data;
}

const config = (extra = {}) => ({
  httpOptions: { timeout: 60_000 },
  responseMimeType: "application/json",
  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
  ...extra,
});

const audio = sampleAudio();
const results = [];
for (const model of [main, fallback].filter(Boolean)) {
  results.push(
    await check("json", model, async () => {
      const res = await ai.models.generateContent({
        model,
        contents: "Suggest one short, honest title for a video clip about a speedrun world record.",
        config: config({
          responseJsonSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
        }),
      });
      const parsed = JSON.parse(res.text ?? "");
      if (typeof parsed.title !== "string") throw new Error("unexpected JSON shape");
      return `ok: "${parsed.title.slice(0, 50)}"`;
    }),
  );
  if (!audio) {
    console.log(`- audio  ${model}  skipped (ffmpeg-static missing; run npm install)`);
    continue;
  }
  results.push(
    await check("audio", model, async () => {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/mp3", data: audio } }, { text: "Transcribe any speech in this audio." }] }],
        config: config({
          responseJsonSchema: {
            type: "object",
            properties: { segments: { type: "array", items: { type: "object", properties: { start: { type: "number" }, end: { type: "number" }, text: { type: "string" } }, required: ["start", "end", "text"] } } },
            required: ["segments"],
          },
        }),
      });
      const parsed = JSON.parse(res.text ?? "");
      if (!Array.isArray(parsed.segments)) throw new Error("unexpected JSON shape");
      return `ok: audio accepted, ${parsed.segments.length} phrases`;
    }),
  );
}

process.exit(results.every(Boolean) ? 0 : 1);
