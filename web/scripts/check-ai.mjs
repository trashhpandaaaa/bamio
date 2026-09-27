#!/usr/bin/env node
/*
 * Checks that your Gemini key and the configured models work.
 *   npm run ai:check            text + voice
 *   npm run ai:check -- --image also tries picture generation (needs a paid plan)
 * Reads web/.env.local the same way Next.js does for the variables it needs.
 */
import { readFileSync, existsSync } from "node:fs";
import { GoogleGenAI, Modality } from "@google/genai";

function loadEnvLocal() {
  const file = new URL("../.env.local", import.meta.url);
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvLocal();
const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const models = {
  text: process.env.BAMIO_TEXT_MODEL || "gemini-3.8-flash",
  image: process.env.BAMIO_IMAGE_MODEL || "gemini-3.1-flash-image",
  voice: process.env.BAMIO_VOICE_MODEL || "gemini-3.8-flash-tts",
};

if (!key) {
  console.error("✗ No GEMINI_API_KEY found. Add it to web/.env.local (see .env.example).");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: key });
const explain = (err) => {
  const status = err?.status;
  if (status === 404) return "model not found. Set a valid model ID in .env.local.";
  if (status === 401 || status === 403) return "this key can't use the model (paid plan needed?).";
  if (status === 429) return "rate limited. Wait a minute and retry.";
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

const results = [];

results.push(
  await check("text", models.text, async () => {
    const res = await ai.models.generateContent({
      model: models.text,
      contents: "Give one short hook for a video about coffee.",
      config: {
        responseMimeType: "application/json",
        responseJsonSchema: {
          type: "object",
          properties: { hooks: { type: "array", minItems: 1, maxItems: 2, items: { type: "string" } } },
          required: ["hooks"],
        },
      },
    });
    const parsed = JSON.parse(res.text ?? "");
    if (!Array.isArray(parsed.hooks) || parsed.hooks.length === 0) throw new Error("unexpected JSON shape");
    return `JSON ok: "${String(parsed.hooks[0]).slice(0, 50)}"`;
  }),
);

results.push(
  await check("voice", models.voice, async () => {
    const res = await ai.models.generateContent({
      model: models.voice,
      contents: [{ role: "user", parts: [{ text: "Say cheerfully: this is Bamio." }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
      },
    });
    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
    if (!part) throw new Error("no audio returned");
    return `audio ok: ${part.inlineData.mimeType}, ${Math.round((part.inlineData.data.length * 3) / 4 / 1024)} KB`;
  }),
);

if (process.argv.includes("--image")) {
  results.push(
    await check("image", models.image, async () => {
      const res = await ai.models.generateContent({
        model: models.image,
        contents: "A vertical photo of a coffee cup on a wooden table, morning light. No text.",
        config: { responseModalities: [Modality.TEXT, Modality.IMAGE], imageConfig: { aspectRatio: "9:16" } },
      });
      const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
      if (!part) throw new Error("no image returned");
      return `image ok: ${part.inlineData.mimeType}`;
    }),
  );
} else {
  console.log(`- image  ${models.image}  skipped (add -- --image to test; needs a paid plan)`);
}

process.exit(results.every(Boolean) ? 0 : 1);
