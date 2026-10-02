import "server-only";
import { startMailer, type Mailer } from "@/lib/server/email";
import { jobPools, jobSpecs } from "@/lib/server/jobs";
import { startWorker, type Worker } from "@/lib/server/worker";

const cache = globalThis as { __bamioWorker?: Worker; __bamioMailer?: Mailer };

/** This process's job worker, and the mailer that sends queued emails: one each, even across development reloads. */
export function startJobsWorker(): Worker {
  cache.__bamioMailer ??= startMailer();
  return (cache.__bamioWorker ??= startWorker(jobSpecs, jobPools()));
}

/** Stop it, handing its running jobs back to the queue for another worker. */
export async function stopJobsWorker(timeoutMs = 15_000) {
  const worker = cache.__bamioWorker;
  const mailer = cache.__bamioMailer;
  cache.__bamioWorker = undefined;
  cache.__bamioMailer = undefined;
  await Promise.all([worker?.stop(timeoutMs), mailer?.stop()]);
}
