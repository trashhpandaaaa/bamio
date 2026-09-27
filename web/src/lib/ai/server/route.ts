import "server-only";
import type { z } from "zod";
import type { AiErrorBody } from "@/lib/ai/contracts";
import { AiError, toAiError } from "@/lib/ai/server/gemini";

const MAX_BODY_BYTES = 64 * 1024;

function fail(error: AiError): Response {
  const body: AiErrorBody = { error: { code: error.code, message: error.message } };
  return Response.json(body, { status: error.status });
}

/** Reject browser requests coming from another site, so no other page can spend this key. */
function isCrossSite(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/**
 * Shared POST handler for AI routes: same-site check, size limit, JSON parsing,
 * zod validation, and error mapping to { error: { code, message } }.
 */
export function aiRoute<S extends z.ZodType>(schema: S, run: (input: z.infer<S>, signal: AbortSignal) => Promise<unknown>) {
  return async function POST(req: Request): Promise<Response> {
    if (isCrossSite(req)) return fail(new AiError("bad_request", "Cross-site requests are not allowed.", 403));
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
      return fail(new AiError("bad_request", "That request is too large.", 413));
    }
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return fail(new AiError("bad_request", "Send a JSON body.", 400));
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail(new AiError("bad_request", issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid request.", 400));
    }
    try {
      return Response.json(await run(parsed.data, req.signal));
    } catch (err) {
      const error = toAiError(err);
      if (error.code === "upstream" || error.code === "bad_output") console.error("[bamio/ai]", err);
      return fail(error);
    }
  };
}
