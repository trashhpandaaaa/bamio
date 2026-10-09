import "server-only";
import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentResponse, type Part } from "@google/genai";
import { HttpError } from "@/lib/server/http";
import { reportError } from "@/lib/server/monitor";

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

/** What a customer is told when the fault is in Bamio's own Gemini setup: it isn't theirs to fix. */
export const AI_SETUP_MESSAGE = "Bamio’s AI isn’t working right now. The problem is on our side, not with your video. Try again later.";

/**
 * A fault in Bamio's own Gemini setup: a rejected key, a project Google has shut out, a model
 * that's gone. Only whoever runs the server can fix it. In production the person reading the
 * message is a customer, so it says the fault is Bamio's, and `detail` (what is wrong, in
 * Google's own words) goes to the log, Sentry and the superadmins' alert email. In development
 * the reader runs the server, and gets the detail.
 */
export class AiSetupError extends HttpError {
  constructor(
    status: number,
    code: string,
    readonly detail: string,
  ) {
    super(status, code, process.env.NODE_ENV === "production" ? AI_SETUP_MESSAGE : detail);
  }
}

/** Google's own sentence from an SDK error, whose message is the JSON body of the answer. */
function googleSays(err: ApiError): string {
  const raw = err.message || "";
  let said = raw;
  try {
    const body = JSON.parse(raw) as { error?: { message?: unknown } };
    if (typeof body.error?.message === "string") said = body.error.message;
  } catch {
    // Not JSON: the message is the sentence.
  }
  const key = apiKey();
  return (key ? said.split(key).join("(the key)") : said).replace(/\s+/g, " ").trim().slice(0, 240);
}

/** Map anything thrown by the SDK or network to a user-facing HttpError. */
export function toAiError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ApiError) {
    const msg = err.message || "";
    if (err.status === 429) return new HttpError(429, "rate_limited", "Gemini is rate limiting this key. Wait a minute, then try again.");
    if (err.status === 400 && /api key/i.test(msg)) {
      return new AiSetupError(401, "no_key", "Gemini rejected the API key. Check GEMINI_API_KEY in web/.env.");
    }
    if (err.status === 404) {
      return new AiSetupError(502, "not_available", "Gemini doesn’t recognise the configured model. Check BAMIO_TEXT_MODEL (run npm run ai:check).");
    }
    if (err.status === 401 || err.status === 403) {
      // Not one cause: a key that may not use the model, a restricted or leaked key, a project Google has suspended. Google says which.
      const said = googleSays(err);
      return new AiSetupError(
        403,
        "not_available",
        `Google refused Bamio’s Gemini key${said ? `: “${said}”` : "."} Look at the key and its project in Google AI Studio (aistudio.google.com/apikey), or put a key from another project in GEMINI_API_KEY.`,
      );
    }
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

export type AiTrouble = { at: number; detail: string };
/** On `globalThis`, like the workers: the alerts check may outlive a development reload of this module. */
const shared = globalThis as { __bamioAiTrouble?: AiTrouble & { reportedAt: number } };

/**
 * The latest fault in the Gemini setup, until a call works again. The alerts check reads it
 * (alerts.ts); it runs in the process that runs the jobs, which is where the AI is called.
 */
export const aiTrouble = (): AiTrouble | null => shared.__bamioAiTrouble ?? null;

/** Remember the fault for the alert, and report it (the log, Sentry) once an hour, not once per video. */
function noteTrouble(err: AiSetupError, cause: unknown) {
  const now = Date.now();
  const last = shared.__bamioAiTrouble;
  const told = last && last.detail === err.detail && now - last.reportedAt < 3600_000;
  shared.__bamioAiTrouble = { at: now, detail: err.detail, reportedAt: told ? last.reportedAt : now };
  if (!told) reportError(cause, "the Gemini setup is broken", { detail: err.detail });
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

/** One line per call: tokens in (and how many came from Gemini's cache), thinking and out. */
function logUsage(task: string, res: GenerateContentResponse) {
  const u = res.usageMetadata;
  if (!u) return;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString("en-US");
  console.log(
    `[bamio/ai] ${task} (${res.modelVersion ?? MODEL}): ${n(u.promptTokenCount)} in${u.cachedContentTokenCount ? ` (${n(u.cachedContentTokenCount)} cached)` : ""}, ${n(u.thoughtsTokenCount)} thinking, ${n(u.candidatesTokenCount)} out`,
  );
}

/**
 * Ask for JSON matching `schema` (optionally about an audio file), validate it with
 * `parse`, and retry once on bad output. Errors are HttpErrors ready for the UI.
 */
export async function generateJson<T>(opts: {
  /** What the call is for, in the log of tokens used. */
  task: string;
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  parse: (value: unknown) => T;
  media?: { mimeType: string; data: string };
  /** Leave unset for the model's default (Gemini 3 is tuned for 1.0; lower can make it loop). */
  temperature?: number;
  /** Less thinking is faster and cheaper; transcription needs almost none. */
  thinking?: "minimal" | "low";
  /** A ceiling on the answer (thinking included), so a runaway answer can't burn tokens. */
  maxOutputTokens?: number;
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
            ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
            ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
            ...(opts.thinking ? { thinkingConfig: { thinkingLevel: opts.thinking === "low" ? ThinkingLevel.LOW : ThinkingLevel.MINIMAL } } : {}),
            httpOptions: { timeout: TIMEOUT_MS, retryOptions: RETRY },
            abortSignal: opts.signal,
          },
        }),
      );
      // Gemini answered: whatever was wrong with the setup is over.
      shared.__bamioAiTrouble = undefined;
      assertNotBlocked(res);
      logUsage(opts.task, res);
      try {
        return opts.parse(JSON.parse(res.text ?? ""));
      } catch (err) {
        lastIssue = err instanceof Error ? err.message.slice(0, 200) : "unparseable";
      }
    }
    throw new HttpError(502, "bad_output", "Gemini answered in an unexpected format. Try again.");
  } catch (err) {
    const mapped = toAiError(err);
    if (mapped instanceof AiSetupError) noteTrouble(mapped, err);
    throw mapped;
  }
}
