import "server-only";
import * as Sentry from "@sentry/node";
import { currentContext } from "@/lib/server/context";

/*
 * Watching the server: error reports to Sentry (with SENTRY_DSN; nothing without it), and log
 * lines as JSON in production, one object per line with the request or job they belong to.
 * The web server sets both up in instrumentation.ts, a worker process in src/worker/main.ts.
 */

/** Sentry for this process, when SENTRY_DSN is set. Error reports only: no performance tracing, no personal data beyond the user id. */
export function initSentry(processName: "web" | "worker") {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || Sentry.isInitialized()) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? (process.env.NODE_ENV === "production" ? "production" : "development"),
    release: process.env.SENTRY_RELEASE,
    // Nothing personal beyond what reportError sets: no cookies, headers, bodies, query strings or automatic user details.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    initialScope: { tags: { process: processName } },
  });
}

/**
 * Report an error that was handled (a job that failed, a route's unexpected 500, an account
 * that wouldn't delete): to Sentry with what the server was doing, and to the log.
 */
export function reportError(err: unknown, where: string, extra: Record<string, unknown> = {}) {
  const ctx = currentContext();
  console.error(`[bamio] ${where}`, err);
  if (!Sentry.isInitialized()) return;
  Sentry.withScope((scope) => {
    scope.setTag("where", where);
    if (ctx.userId) scope.setUser({ id: ctx.userId });
    if (ctx.reqId) scope.setTag("request_id", ctx.reqId);
    if (ctx.kind) scope.setTag("job_kind", ctx.kind);
    scope.setContext("bamio", { ...ctx, ...extra });
    Sentry.captureException(err);
  });
}

/** A warning worth a person's attention (an alert), to Sentry as a message. */
export function reportMessage(message: string, extra: Record<string, unknown> = {}) {
  if (!Sentry.isInitialized()) return;
  Sentry.withScope((scope) => {
    scope.setContext("bamio", extra);
    Sentry.captureMessage(message, "warning");
  });
}

/** Let reports in flight reach Sentry before the process exits. */
export const flushReports = (timeoutMs = 2000) => (Sentry.isInitialized() ? Sentry.flush(timeoutMs) : Promise.resolve(true));

type Level = "debug" | "info" | "warn" | "error";

const serialise = (value: unknown): unknown =>
  value instanceof Error ? { name: value.name, message: value.message, stack: value.stack, ...(value.cause ? { cause: serialise(value.cause) } : {}) } : value;

/** One log line as JSON: time, level, message (the strings), the error and any data, and the request or job. */
export function jsonLine(level: Level, args: unknown[]): string {
  const words: string[] = [];
  const data: unknown[] = [];
  let err: unknown;
  for (const a of args) {
    if (typeof a === "string" || typeof a === "number" || typeof a === "boolean") words.push(String(a));
    else if (a instanceof Error && err === undefined) err = serialise(a);
    else if (a !== undefined) data.push(serialise(a));
  }
  const line: Record<string, unknown> = { time: new Date().toISOString(), level, msg: words.join(" "), ...currentContext() };
  if (err !== undefined) line.err = err;
  if (data.length) line.data = data.length === 1 ? data[0] : data;
  try {
    return JSON.stringify(line);
  } catch {
    return JSON.stringify({ time: line.time, level, msg: line.msg, unserialisable: true });
  }
}

/**
 * In production, console.log/info/warn/error write JSON lines (jsonLine) instead of text, so
 * the code keeps logging with console and every line carries its request or job. Once per process.
 */
export function startJsonConsole() {
  const marker = globalThis as { __bamioJsonConsole?: boolean };
  if (process.env.NODE_ENV !== "production" || process.env.BAMIO_LOG_FORMAT === "text" || marker.__bamioJsonConsole) return;
  marker.__bamioJsonConsole = true;
  const out = (stream: NodeJS.WriteStream, level: Level) => (...args: unknown[]) => void stream.write(`${jsonLine(level, args)}\n`);
  console.debug = out(process.stdout, "debug");
  console.log = out(process.stdout, "info");
  console.info = out(process.stdout, "info");
  console.warn = out(process.stderr, "warn");
  console.error = out(process.stderr, "error");
}
