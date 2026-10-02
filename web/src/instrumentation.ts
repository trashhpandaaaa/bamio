/*
 * Runs once when a server starts. Unless BAMIO_WORKER=off, this server is also a job worker:
 * it runs imports, exports and followed streams from the queue (src/lib/server/worker.ts).
 * With BAMIO_WORKER=off it only queues them, for worker processes (`npm run worker`).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.BAMIO_WORKER === "off" || process.env.NEXT_PHASE === "phase-production-build") return;
  const { startJobsWorker } = await import("@/lib/server/worker-start");
  startJobsWorker();
}
