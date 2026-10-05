import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/*
 * What the server is working on right now: a request (its id, the signed-in user) or a job.
 * Log lines (monitor.ts) and error reports carry it, so one request or one job can be followed
 * through the logs.
 */
export type LogContext = { reqId?: string; userId?: string; jobId?: number; kind?: string; projectId?: string };

const store: AsyncLocalStorage<LogContext> = ((globalThis as { __bamioContext?: AsyncLocalStorage<LogContext> }).__bamioContext ??= new AsyncLocalStorage<LogContext>());

/** Run `fn` with `ctx` added to the context it inherits. */
export const withContext = <T>(ctx: LogContext, fn: () => T): T => store.run({ ...store.getStore(), ...ctx }, fn);

export const currentContext = (): LogContext => store.getStore() ?? {};

/** A request's id: Cloudflare's ray id when it came through Cloudflare, else one made here. */
export function requestId(req: Request): string {
  const given = req.headers.get("cf-ray") ?? req.headers.get("x-request-id");
  return given && /^[\w-]{1,100}$/.test(given) ? given : crypto.randomUUID();
}
