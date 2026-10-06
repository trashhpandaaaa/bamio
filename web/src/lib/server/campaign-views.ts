import "server-only";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { CLIP_PLATFORM_IDS, CLIP_PLATFORMS } from "@/lib/campaigns/links";
import { isAbortError, ProcessError, run } from "@/lib/server/bin";
import { closeIfSpent, endDueCampaigns, VIEWS_CHANNEL } from "@/lib/server/campaigns";
import { db } from "@/lib/server/db";
import { ytdlpArgs } from "@/lib/server/media";

/*
 * Counting the views of campaign clips. The workers' counter (startViewCounter, started with
 * the job worker) reads each clip's view count from its page with yt-dlp, the way imports read
 * a link: a new clip within moments, then every BAMIO_VIEWS_EVERY_MIN (360: four times a day)
 * while its campaign runs. One clip at a time, so a busy server isn't slowed. Sites that show
 * views only to signed-in people (Instagram, X) aren't asked: an admin types those in, and a
 * typed number always wins. When a site won't answer, the last count stays and the reason is kept
 * for admins. Counts stop when a campaign ends. BAMIO_VIEW_COUNTS=off turns the counter off.
 */

export type ViewCount = { views: number | null; title: string | null; author: string | null };
export type ViewLookup = (url: string, signal?: AbortSignal) => Promise<ViewCount>;

const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** A post's view count, title and the account that posted it, as its site says. Throws when the page can't be read. */
export const lookupViews: ViewLookup = async (url, signal) => {
  const { stdout } = await run("yt-dlp", [...ytdlpArgs(), "-J", "--skip-download", "--", url], { signal, timeoutMs: 90_000, collectStdout: 30 * 1024 * 1024 });
  const info = JSON.parse(stdout) as { view_count?: unknown; title?: unknown; uploader?: unknown; uploader_id?: unknown; channel?: unknown };
  const views = typeof info.view_count === "number" && Number.isFinite(info.view_count) && info.view_count >= 0 ? Math.floor(info.view_count) : null;
  // The account's handle where the site gives one (YouTube "@name", X "name"); TikTok's id is a number, so its name is used.
  const handle = text(info.uploader_id, 60);
  const author = (handle && !/^\d+$/.test(handle) ? handle : (text(info.uploader, 60) ?? text(info.channel, 60)))?.replace(/^@/, "") ?? null;
  return { views, title: text(info.title, 200), author };
};

const everyMs = () => Math.max(5, Number(process.env.BAMIO_VIEWS_EVERY_MIN) || 360) * 60_000;

/** Why a page couldn't be read, short enough for a table cell. */
function reason(err: unknown): string {
  const tail = err instanceof ProcessError ? err.stderrTail : err instanceof Error ? err.message : String(err);
  const last = tail.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "The page couldn’t be read.";
  return last.replace(/^ERROR:\s*/, "").slice(0, 300);
}

/** Count the views of the clip that has waited longest. False when none is due. */
export async function countNextViews(lookup: ViewLookup = lookupViews, now = Date.now(), signal?: AbortSignal): Promise<boolean> {
  const sql = db();
  const counted = CLIP_PLATFORM_IDS.filter((p) => CLIP_PLATFORMS[p].counted);
  // Claimed by its check time, so a clip whose page hangs or crashes the reader waits its turn again.
  const [clip] = await sql<{ id: number; url: string; campaign_id: string }[]>`
    update campaign_clips set views_checked_at = ${now}
    where id = (
      select c.id from campaign_clips c join campaigns g on g.id = c.campaign_id
      where c.status <> 'rejected' and g.status in ('live', 'paused') and c.platform in ${sql(counted)}
        and (c.views_checked_at is null or c.views_checked_at <= ${now - everyMs()})
      order by c.views_checked_at nulls first, c.id
      limit 1
      for update of c skip locked
    )
    returning id::int as id, url, campaign_id`;
  if (!clip) return false;
  try {
    const found = await lookup(clip.url, signal);
    await sql`
      update campaign_clips set views = coalesce(${found.views}, views), views_error = ${found.views === null ? "The site didn’t give a view count." : null},
        title = coalesce(${found.title}, title), author = coalesce(${found.author}, author)
      where id = ${clip.id}`;
  } catch (err) {
    if (isAbortError(err)) {
      // Stopped mid-read (the worker is shutting down): due again at once.
      await sql`update campaign_clips set views_checked_at = null where id = ${clip.id}`;
      throw err;
    }
    await sql`update campaign_clips set views_error = ${reason(err)} where id = ${clip.id}`;
  }
  await closeIfSpent(clip.campaign_id);
  return true;
}

export type ViewCounter = { stop: () => Promise<void> };

/** Counts views as clips come in (and every minute, for the ones due again), and ends campaigns whose last day has passed. */
export function startViewCounter(lookup: ViewLookup = lookupViews, opts: { pollMs?: number; pauseMs?: number; log?: (m: string) => void } = {}): ViewCounter {
  if (process.env.BAMIO_VIEW_COUNTS === "off") return { stop: async () => undefined };
  const log = opts.log ?? ((m: string) => console.log(m));
  const id = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const stopper = new AbortController();
  let stopping = false;
  let running: Promise<void> | null = null;
  let again = false;
  let quietUntil = 0;

  function kick() {
    if (stopping) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await endDueCampaigns();
          while (!stopping && (await countNextViews(lookup, Date.now(), stopper.signal))) {
            // A breath between pages, for the sites and for the server.
            await new Promise((r) => setTimeout(r, opts.pauseMs ?? 1500));
          }
        } catch (err) {
          if (!stopping && Date.now() >= quietUntil) {
            log(`[bamio/campaigns] ${id} can't count views: ${err instanceof Error ? err.message : String(err)}`);
            quietUntil = Date.now() + 60_000;
          }
        }
      } while (again && !stopping);
    })().finally(() => {
      running = null;
    });
  }

  const listening = db()
    .listen(VIEWS_CHANNEL, () => kick())
    .catch(() => null);
  const poll = setInterval(kick, opts.pollMs ?? 60_000);
  poll.unref?.();
  kick();
  return {
    async stop() {
      stopping = true;
      clearInterval(poll);
      stopper.abort();
      await (await listening)?.unlisten().catch(() => undefined);
      await running;
    },
  };
}
