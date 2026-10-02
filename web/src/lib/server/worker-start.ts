import "server-only";
import { jobPools, jobSpecs } from "@/lib/server/jobs";
import { startWorker, type Worker } from "@/lib/server/worker";

const cache = globalThis as { __bamioWorker?: Worker };

/** This process's job worker: one, even across development reloads. */
export function startJobsWorker(): Worker {
  return (cache.__bamioWorker ??= startWorker(jobSpecs, jobPools()));
}

/** Stop it, handing its running jobs back to the queue for another worker. */
export async function stopJobsWorker(timeoutMs = 15_000) {
  const worker = cache.__bamioWorker;
  cache.__bamioWorker = undefined;
  await worker?.stop(timeoutMs);
}
