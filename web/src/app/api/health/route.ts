import { binVersion } from "@/lib/server/bin";
import { db } from "@/lib/server/db";
import { storage } from "@/lib/server/storage";

/*
 * For load balancers and monitoring: 200 when the database and storage answer (503 when
 * not), with the job queue's depth and whether the media tools are installed. Public (no
 * session, like Stripe's webhook), so it says nothing about users or settings.
 */

type Check = { ok: boolean; ms: number; error?: string };

async function check(run: () => Promise<unknown>, timeoutMs = 5_000): Promise<Check> {
  const started = Date.now();
  try {
    await Promise.race([run(), new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), timeoutMs))]);
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: (err as { code?: string }).code ?? (err instanceof Error ? err.message.slice(0, 80) : "failed") };
  }
}

export async function GET() {
  let queue: { waiting: number; running: number; oldestWaitingSec: number } | null = null;
  const [database, objects, ffmpeg, ytdlp] = await Promise.all([
    check(async () => {
      const now = Date.now();
      const [row] = await db()<{ waiting: number; running: number; oldest: number | null }[]>`
        select count(*) filter (where status = 'queued' and run_after <= ${now})::int as waiting,
               count(*) filter (where status = 'running' and lease_until >= ${now})::int as running,
               min(run_after) filter (where status = 'queued' and run_after <= ${now})::float8 as oldest
        from jobs where status in ('queued', 'running')`;
      queue = { waiting: row?.waiting ?? 0, running: row?.running ?? 0, oldestWaitingSec: row?.oldest ? Math.round((now - row.oldest) / 1000) : 0 };
    }),
    // A key that never exists: reaching storage is what's checked.
    check(() => storage().stat("health/probe")),
    binVersion("ffmpeg"),
    binVersion("yt-dlp"),
  ]);
  const ok = database.ok && objects.ok;
  const body = {
    status: ok ? (ffmpeg && ytdlp ? "ok" : "degraded") : "down",
    checks: { database, storage: { ...objects, driver: storage().name }, queue, tools: { ffmpeg: Boolean(ffmpeg), ytdlp: Boolean(ytdlp) } },
  };
  return Response.json(body, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
