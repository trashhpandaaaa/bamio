import "server-only";
import { startAccountSweeper, type AccountSweeper } from "@/lib/server/accounts";
import { startAlerts, type Alerter } from "@/lib/server/alerts";
import { startViewCounter, type ViewCounter } from "@/lib/server/campaign-views";
import { startDownloader, type Downloader } from "@/lib/server/downloads";
import { startMailer, type Mailer } from "@/lib/server/email";
import { jobPools, jobSpecs } from "@/lib/server/jobs";
import { startWorker, type Worker } from "@/lib/server/worker";

const cache = globalThis as { __bamioWorker?: Worker; __bamioMailer?: Mailer; __bamioAccounts?: AccountSweeper; __bamioAlerts?: Alerter; __bamioViews?: ViewCounter; __bamioDownloads?: Downloader };

/** This process's job worker, the mailer that sends queued emails, the sweeper that deletes accounts, the counter of campaign clips' views, the downloader and the alerts check: one each, even across development reloads. */
export function startJobsWorker(): Worker {
  cache.__bamioMailer ??= startMailer();
  cache.__bamioAccounts ??= startAccountSweeper();
  cache.__bamioAlerts ??= startAlerts();
  cache.__bamioViews ??= startViewCounter();
  cache.__bamioDownloads ??= startDownloader();
  return (cache.__bamioWorker ??= startWorker(jobSpecs, jobPools()));
}

/** Stop it, handing its running jobs back to the queue for another worker. */
export async function stopJobsWorker(timeoutMs = 15_000) {
  const worker = cache.__bamioWorker;
  const mailer = cache.__bamioMailer;
  const accounts = cache.__bamioAccounts;
  const views = cache.__bamioViews;
  const downloads = cache.__bamioDownloads;
  cache.__bamioAlerts?.stop();
  cache.__bamioAlerts = undefined;
  cache.__bamioWorker = undefined;
  cache.__bamioMailer = undefined;
  cache.__bamioAccounts = undefined;
  cache.__bamioViews = undefined;
  cache.__bamioDownloads = undefined;
  await Promise.all([worker?.stop(timeoutMs), mailer?.stop(), accounts?.stop(), views?.stop(), downloads?.stop()]);
}
