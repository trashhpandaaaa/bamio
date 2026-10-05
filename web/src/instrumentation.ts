import type { Instrumentation } from "next";

/*
 * Runs once when a server starts. Error reports go to Sentry (with SENTRY_DSN) and, in
 * production, log lines are JSON (src/lib/server/monitor.ts). Unless BAMIO_WORKER=off, this
 * server is also a job worker: it runs imports, exports and followed streams from the queue
 * (src/lib/server/worker.ts). With BAMIO_WORKER=off it only queues them, for worker processes
 * (`npm run worker`).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { initSentry, startJsonConsole } = await import("@/lib/server/monitor");
  startJsonConsole();
  initSentry("web");
  if (process.env.BAMIO_WORKER === "off") return;
  const { startJobsWorker } = await import("@/lib/server/worker-start");
  startJobsWorker();
}

/** Errors Next.js catches itself (a page or route that throws): to Sentry. Routes' own handled errors are reported in http.ts. */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportError } = await import("@/lib/server/monitor");
  reportError(err, `${context.routeType} ${context.routePath}`, { method: request.method, path: request.path.split("?")[0] });
};
