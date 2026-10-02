/*
 * A worker process: runs jobs from the queue (imports, exports, followed streams) and sends
 * queued emails, and nothing else. Run as many as the machines allow, beside web servers started with BAMIO_WORKER=off.
 * Built into dist/worker.mjs by `npm run build:worker`; run from web/ with `npm run worker`.
 * Reads web/.env and web/.env.local like Next.js does. Stops cleanly on Ctrl+C or SIGTERM,
 * handing running jobs back to the queue.
 */
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");

const { startJobsWorker, stopJobsWorker } = await import("@/lib/server/worker-start");
startJobsWorker();

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log("[bamio/worker] stopping: handing running jobs back to the queue…");
    void stopJobsWorker().finally(() => process.exit(0));
  });
}
