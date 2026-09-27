import "server-only";
import { ApiError, GoogleGenAI, Modality, type GenerateContentResponse } from "@google/genai";
import type { AiErrorCode, AiStatus } from "@/lib/ai/contracts";

/* Model IDs are configurable so a renamed or retired model is a .env change, not a code change. */
export const MODELS = {
  text: process.env.BAMIO_TEXT_MODEL || "gemini-3.8-flash",
  image: process.env.BAMIO_IMAGE_MODEL || "gemini-3.1-flash-image",
  voice: process.env.BAMIO_VOICE_MODEL || "gemini-3.8-flash-tts",
} as const;

const TEXT_TIMEOUT_MS = 60_000;
const MEDIA_TIMEOUT_MS = 90_000;

export const isMock = () => process.env.BAMIO_AI_MOCK === "1";
const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

export function aiStatus(): AiStatus {
  return { configured: isMock() || apiKey().length > 0, mock: isMock(), models: { ...MODELS } };
}

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  const key = apiKey();
  if (!key) {
    throw new AiError("no_key", "Add GEMINI_API_KEY to web/.env.local, then restart the server.", 503);
  }
  client ??= new GoogleGenAI({ apiKey: key });
  return client;
}

/** Map anything thrown by the SDK or network to a user-facing AiError. */
export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof ApiError) {
    const msg = err.message || "";
    if (err.status === 429) {
      return new AiError("rate_limited", "Gemini is rate limiting this key. Wait a minute, then try again.", 429);
    }
    if (err.status === 400 && /api key/i.test(msg)) {
      return new AiError("no_key", "Gemini rejected the API key. Check GEMINI_API_KEY in web/.env.local.", 401);
    }
    if (err.status === 404) {
      return new AiError(
        "not_available",
        "Gemini doesn’t recognise the configured model. Check the BAMIO_*_MODEL settings in web/.env.local (run npm run ai:check).",
        502,
      );
    }
    if (err.status === 401 || err.status === 403) {
      return new AiError(
        "not_available",
        "Your API key can’t use this Gemini feature. Picture generation needs a paid plan; upload your own pictures instead.",
        403,
      );
    }
    if (err.status >= 500) {
      return new AiError("upstream", "Gemini had a problem on its side. Try again in a moment.", 502);
    }
    return new AiError("upstream", `Gemini could not handle the request (${err.status}).`, 502);
  }
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return new AiError("upstream", "Gemini took too long to answer. Try again.", 504);
  }
  return new AiError("upstream", "Something went wrong talking to Gemini. Try again.", 502);
}

function assertNotBlocked(res: GenerateContentResponse) {
  const reason = res.promptFeedback?.blockReason;
  const finish = String(res.candidates?.[0]?.finishReason ?? "");
  if (reason || ["SAFETY", "PROHIBITED_CONTENT", "IMAGE_SAFETY", "IMAGE_PROHIBITED_CONTENT"].includes(finish)) {
    throw new AiError("blocked", "Gemini would not make this. Rephrase the idea or the scene and try again.", 422);
  }
}

/** Ask for JSON that matches `schema`, validate it with `parse`, and retry once on bad output. */
export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  parse: (value: unknown) => T;
  temperature?: number;
  signal?: AbortSignal;
}): Promise<T> {
  const ai = getClient();
  let lastIssue = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await ai.models.generateContent({
      model: MODELS.text,
      contents: attempt === 0 ? opts.prompt : `${opts.prompt}\n\nYour previous answer was invalid (${lastIssue}). Reply with JSON that matches the schema exactly.`,
      config: {
        systemInstruction: opts.system,
        responseMimeType: "application/json",
        responseJsonSchema: opts.schema,
        temperature: opts.temperature ?? 0.9,
        httpOptions: { timeout: TEXT_TIMEOUT_MS },
        abortSignal: opts.signal,
      },
    });
    assertNotBlocked(res);
    try {
      return opts.parse(JSON.parse(res.text ?? ""));
    } catch (err) {
      lastIssue = err instanceof Error ? err.message.slice(0, 200) : "unparseable";
    }
  }
  throw new AiError("bad_output", "Gemini answered in an unexpected format. Try again.", 502);
}

function firstInlineData(res: GenerateContentResponse) {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.inlineData?.data) {
      return { data: part.inlineData.data, mimeType: part.inlineData.mimeType ?? "application/octet-stream" };
    }
  }
  return null;
}

export async function generateImage(prompt: string, signal?: AbortSignal) {
  const ai = getClient();
  const res = await ai.models.generateContent({
    model: MODELS.image,
    contents: prompt,
    config: {
      responseModalities: [Modality.TEXT, Modality.IMAGE],
      imageConfig: { aspectRatio: "9:16" },
      httpOptions: { timeout: MEDIA_TIMEOUT_MS },
      abortSignal: signal,
    },
  });
  assertNotBlocked(res);
  const image = firstInlineData(res);
  if (!image || !image.mimeType.startsWith("image/")) {
    throw new AiError("bad_output", "Gemini did not return an image. Try again or rephrase the scene.", 502);
  }
  return image;
}

export async function generateSpeech(text: string, voiceName: string, signal?: AbortSignal) {
  const ai = getClient();
  const res = await ai.models.generateContent({
    model: MODELS.voice,
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      httpOptions: { timeout: MEDIA_TIMEOUT_MS },
      abortSignal: signal,
    },
  });
  assertNotBlocked(res);
  const audio = firstInlineData(res);
  if (!audio) throw new AiError("bad_output", "Gemini did not return any audio. Try again.", 502);
  return audio;
}
