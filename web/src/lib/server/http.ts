import "server-only";
import type { z } from "zod";
import { requestId, withContext } from "@/lib/server/context";
import { isDatabaseDown } from "@/lib/server/db";
import { reportError } from "@/lib/server/monitor";

/** An error with a status and a message that is safe to show to the user. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export type ErrorBody = { error: { code: string; message: string } };

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    const body: ErrorBody = { error: { code: err.code, message: err.message } };
    return Response.json(body, { status: err.status });
  }
  if (isDatabaseDown(err)) {
    reportError(err, "database unreachable");
    const body: ErrorBody = { error: { code: "unavailable", message: "Bamio can’t reach its database right now. Try again in a moment." } };
    return Response.json(body, { status: 503 });
  }
  reportError(err, "unexpected error in a route");
  const body: ErrorBody = { error: { code: "internal", message: "Something went wrong on our side. Try again." } };
  return Response.json(body, { status: 500 });
}

/** Reject browser requests sent by another site (the session cookie alone is not proof of intent). */
export function isCrossSite(req: Request): boolean {
  if (req.headers.get("sec-fetch-site") === "cross-site") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** Parse and validate a small JSON body. */
export async function readJson<S extends z.ZodType>(req: Request, schema: S, maxBytes = 64 * 1024): Promise<z.infer<S>> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) throw new HttpError(413, "too_large", "That request is too large.");
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > maxBytes) throw new HttpError(413, "too_large", "That request is too large.");
    body = JSON.parse(text);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, "bad_request", "Send a JSON body.");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, "bad_request", issue ? `${issue.path.join(".") || "request"}: ${issue.message}` : "Invalid request.");
  }
  return parsed.data;
}

/* ------------------------------ Rate limits ------------------------------ */

type Bucket = { count: number; resetAt: number };
const buckets: Map<string, Bucket> = ((globalThis as { __bamioRate?: Map<string, Bucket> }).__bamioRate ??= new Map());

/** Fixed-window limit per key. Throws 429 when the window is used up. */
export function takeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()) {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
    if (buckets.size > 5000) {
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    }
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    const wait = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    throw new HttpError(429, "rate_limited", `You’re going a bit fast. Try again in ${wait} seconds.`);
  }
}

/* -------------------------------- Handler -------------------------------- */

export type RateRule = { bucket: string; limit: number; windowMs: number };
type Params = Record<string, string>;

/**
 * Wraps a route handler: signed-in user required, cross-site writes refused, optional
 * per-user rate limit, and every thrown error mapped to { error: { code, message } }.
 */
export function userRoute<P extends Params = Params>(
  run: (req: Request, ctx: { userId: string; params: P }) => Promise<Response>,
  opts: { rate?: RateRule } = {},
) {
  return async (req: Request, ctx: { params: Promise<P> }): Promise<Response> => {
    // Log lines and error reports from here on carry the request's id (and the user, once known);
    // the answer says it too (x-request-id), so a user's report can be found in the logs.
    const reqId = requestId(req);
    const res = await withContext({ reqId }, async () => {
      try {
        if (req.method !== "GET" && req.method !== "HEAD" && isCrossSite(req)) {
          throw new HttpError(403, "forbidden", "Cross-site requests are not allowed.");
        }
        const userId = await currentUserId();
        if (!userId) throw new HttpError(401, "signed_out", "Sign in to continue.");
        if (opts.rate) takeRateLimit(`${opts.rate.bucket}:${userId}`, opts.rate.limit, opts.rate.windowMs);
        const params = await ctx.params;
        return await withContext({ userId }, () => run(req, { userId, params }));
      } catch (err) {
        return errorResponse(err);
      }
    });
    try {
      res.headers.set("x-request-id", reqId);
    } catch {
      // Some responses (redirects) have fixed headers.
    }
    return res;
  };
}

async function currentUserId(): Promise<string | null> {
  // Imported lazily so unit tests can load this module without Clerk.
  const { auth } = await import("@clerk/nextjs/server");
  const { userId } = await auth();
  return userId;
}

/** A filename safe for Content-Disposition, keeping the readable part of a title. */
export function attachmentName(title: string, ext: string): string {
  const base = title.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "clip";
  return `${base}.${ext}`;
}
