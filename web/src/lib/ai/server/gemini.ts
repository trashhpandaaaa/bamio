import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentResponse, type Part } from "@google/genai";
import { HttpError } from "@/lib/server/http";

/* Model IDs are configurable so a renamed or retired model is a .env change, not a code change. */
export const MODEL = process.env.BAMIO_TEXT_MODEL || "gemini-3.8-flash";

/** Empty or "none" disables the fallback. */
function fallbackFromEnv(name: string, fallback: string): string | null {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "" || value === "none" ? null : value;
}

/** A lighter model used once when the main model is busy, rate limited, down or retired. */
export const FALLBACK_MODEL = fallbackFromEnv("BAMIO_TEXT_FALLBACK_MODEL", "gemini-3.5-flash-lite");

const TIMEOUT_MS = 240_000;

/*
 * Gemini sometimes answers 503 "high demand" or other brief 5xx errors. Retry those
 * with jittered exponential backoff. 429 is not retried on the same model.
 */
const RETRY = { attempts: 3, initialDelay: 1, maxDelay: 6, expBase: 2, jitter: 0.5, httpStatusCodes: [408, 500, 502, 503, 504] };

export const isMock = () => process.env.BAMIO_AI_MOCK === "1";
const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
export const aiConfigured = () => isMock() || apiKey().length > 0;

let client: { key: string; ai: GoogleGenAI } | null = null;
/** A client for the current key: a key changed in .env is picked up without a restart. */
function getClient(): GoogleGenAI {
  const key = apiKey();
  if (!key) throw new HttpError(503, "no_key", "Add GEMINI_API_KEY to web/.env, then restart the server.");
  if (client?.key !== key) client = { key, ai: new GoogleGenAI({ apiKey: key }) };
  return client.ai;
}

/** Map anything thrown by the SDK or network to a user-facing HttpError. */
export function toAiError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ApiError) {
    const msg = err.message || "";
    if (err.status === 429) return new HttpError(429, "rate_limited", "Gemini is rate limiting this key. Wait a minute, then try again.");
    if (err.status === 400 && /api key/i.test(msg)) {
      return new HttpError(401, "no_key", "Gemini rejected the API key. Check GEMINI_API_KEY in web/.env.");
    }
    if (err.status === 404) {
      return new HttpError(502, "not_available", "Gemini doesn’t recognise the configured model. Check BAMIO_TEXT_MODEL (run npm run ai:check).");
    }
    if (err.status === 401 || err.status === 403) return new HttpError(403, "not_available", "Your API key can’t use this Gemini model.");
    if (err.status === 503) return new HttpError(503, "upstream", "Gemini is very busy right now. Try again in a minute.");
    if (err.status >= 500) return new HttpError(502, "upstream", "Gemini had a problem on its side. Try again in a moment.");
    return new HttpError(502, "upstream", `Gemini could not handle the request (${err.status}).`);
  }
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return new HttpError(504, "upstream", "Gemini took too long to answer. Try again.");
  }
  return new HttpError(502, "upstream", "Something went wrong talking to Gemini. Try again.");
}

/**
 * True when another model could help: busy or erroring (5xx), missing (404), rate
 * limited (429: limits are per model), or a timeout / lost connection.
 */
export function shouldFallBack(err: unknown): boolean {
  if (err instanceof HttpError) return false;
  if (err instanceof ApiError) return [404, 429, 500, 502, 503, 504].includes(err.status);
  if (!(err instanceof Error)) return false;
  return err.name === "TimeoutError" || /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|timed? ?out/i.test(err.message);
}

async function withFallback<T>(signal: AbortSignal | undefined, call: (model: string) => Promise<T>): Promise<T> {
  try {
    return await call(MODEL);
  } catch (err) {
    if (!FALLBACK_MODEL || FALLBACK_MODEL === MODEL || signal?.aborted || !shouldFallBack(err)) throw err;
    const reason = err instanceof ApiError ? `status ${err.status}` : err instanceof Error ? err.message.slice(0, 80) : "error";
    console.warn(`[bamio/ai] ${MODEL} unavailable (${reason}); retrying with ${FALLBACK_MODEL}`);
    return call(FALLBACK_MODEL);
  }
}

function assertNotBlocked(res: GenerateContentResponse) {
  const reason = res.promptFeedback?.blockReason;
  const finish = String(res.candidates?.[0]?.finishReason ?? "");
  if (reason || ["SAFETY", "PROHIBITED_CONTENT"].includes(finish)) {
    throw new HttpError(422, "blocked", "Gemini would not process this content.");
  }
}

/**
 * Ask for JSON matching `schema` (optionally about an audio file), validate it with
 * `parse`, and retry once on bad output. Errors are HttpErrors ready for the UI.
 */
export async function generateJson<T>(opts: {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  parse: (value: unknown) => T;
  media?: { mimeType: string; data: string };
  temperature?: number;
  /** Less thinking is faster and cheaper; transcription needs almost none. */
  thinking?: "minimal" | "low";
  signal?: AbortSignal;
}): Promise<T> {
  try {
    const ai = getClient();
    let lastIssue = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const text =
        attempt === 0 ? opts.prompt : `${opts.prompt}\n\nYour previous answer was invalid (${lastIssue}). Reply with JSON that matches the schema exactly.`;
      const parts: Part[] = opts.media ? [{ inlineData: opts.media }, { text }] : [{ text }];
      const res = await withFallback(opts.signal, (model) =>
        ai.models.generateContent({
          model,
          contents: [{ role: "user", parts }],
          config: {
            systemInstruction: opts.system,
            responseMimeType: "application/json",
            responseJsonSchema: opts.schema,
            temperature: opts.temperature ?? 0.4,
            ...(opts.thinking ? { thinkingConfig: { thinkingLevel: opts.thinking === "low" ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL } } : {}),
            httpOptions: { timeout: TIMEOUT_MS, retryOptions: RETRY },
            abortSignal: opts.signal,
          },
        }),
      );
      assertNotBlocked(res);
      try {
        return opts.parse(JSON.parse(res.text ?? ""));
      } catch (err) {
        lastIssue = err instanceof Error ? err.message.slice(0, 200) : "unparseable";
      }
    }
    throw new HttpError(502, "bad_output", "Gemini answered in an unexpected format. Try again.");
  } catch (err) {
    throw toAiError(err);
  }
}
