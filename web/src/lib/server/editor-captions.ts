import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { segmentWordTimes, splitWords } from "@/lib/clips/logic";
import { languageSchema } from "@/lib/clips/schema";
import { can } from "@/lib/editor/features";
import type { CaptionWord } from "@/lib/editor/model";
import { isAbortError } from "@/lib/server/bin";
import { assertCanProcess, recordUsage } from "@/lib/server/billing";
import { db } from "@/lib/server/db";
import { editorLevel } from "@/lib/server/editor-access";
import { HttpError } from "@/lib/server/http";
import { probe } from "@/lib/server/media";
import { reportError } from "@/lib/server/monitor";
import { isProjectId, isUserId, workRoot } from "@/lib/server/store";
import { transcribeLocal } from "@/lib/server/transcribe";

/*
 * Auto captions in the editor (Pro). The editor runs in the browser and uploads nothing, except
 * here, when someone asks for captions: the sound of the parts their edit uses comes up as one
 * WAV (mono, 16 kHz), is transcribed by Bamio's own transcriber (transcribe.ts, every language,
 * a time for every word), and the words go back to the browser. The sound is deleted as soon as
 * it's transcribed; the words after a day. It uses AI minutes like an import (keyed, so a retry
 * counts once).
 *
 * caption_jobs is its own queue, like downloads: the route writes a row, the workers' captioner
 * (startCaptioner, started with the job worker) claims rows by lease, one at a time.
 */

export const CAPTION_LIMITS = {
  /** The most sound one request may send, in seconds. */
  maxSec: 20 * 60,
  /** A WAV of that, with room to spare. */
  maxBytes: 20 * 60 * 32_000 + 1_000_000,
} as const;

const HOUR = 3600_000;
const LEASE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 3;
export const CAPTIONS_CHANNEL = "bamio_captions";

const notFound = () => new HttpError(404, "not_found", "Those captions don’t exist.");
const dirOf = (id: string) => path.join(workRoot(), "captions", id.toLowerCase());

export type CaptionJob = { id: string; status: "queued" | "working" | "ready" | "failed"; progress: number | null; error: string | null; words: CaptionWord[] | null; language: string | null };

/**
 * Take the sound of an edit for captioning: Pro (or plans off), minutes left, a WAV no longer
 * than CAPTION_LIMITS. Returns the job's id.
 */
export async function startCaptions(userId: string, body: Uint8Array, opts: { language?: string }, now = Date.now()): Promise<string> {
  if (!isUserId(userId)) throw new HttpError(400, "bad_request", "Unknown user.");
  if (!can(await editorLevel(userId), "autoCaptions")) throw new HttpError(402, "plan_required", "Auto captions in the editor come with Pro.");
  if (body.byteLength > CAPTION_LIMITS.maxBytes) throw new HttpError(413, "too_long", `Captions can be made for up to ${CAPTION_LIMITS.maxSec / 60} minutes of sound at once.`);
  const language = opts.language && opts.language !== "auto" ? languageSchema.parse(opts.language) : undefined;
  const id = randomUUID();
  const dir = dirOf(id);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "sound.wav");
  await writeFile(file, body);
  try {
    const info = await probe(file).catch(() => null);
    if (!info?.hasAudio || !(info.durationSec > 0)) throw new HttpError(422, "unreadable", "That sound couldn’t be read. Try again.");
    if (info.durationSec > CAPTION_LIMITS.maxSec + 1) throw new HttpError(413, "too_long", `Captions can be made for up to ${CAPTION_LIMITS.maxSec / 60} minutes of sound at once.`);
    await assertCanProcess(userId, { sec: info.durationSec, source: "upload" });
    await db()`insert into caption_jobs (id, user_id, language, duration_sec, created_at) values (${id}, ${userId}, ${language ?? null}, ${info.durationSec}, ${now})`;
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  await db()`select pg_notify(${CAPTIONS_CHANNEL}, '')`;
  return id;
}

/** A job, as its owner sees it. */
export async function captionJob(userId: string, id: string): Promise<CaptionJob> {
  if (!isUserId(userId) || !isProjectId(id)) throw notFound();
  const [row] = await db()<{ status: CaptionJob["status"]; progress: number | null; error: string | null; result: { words: CaptionWord[]; language: string | null } | null }[]>`
    select status, progress, error, result from caption_jobs where id = ${id} and user_id = ${userId}`;
  if (!row) throw notFound();
  return { id, status: row.status, progress: row.progress === null ? null : Number(row.progress), error: row.error, words: row.result?.words ?? null, language: row.result?.language ?? null };
}

/** Words from a transcript's phrases, a time for each. */
export function wordsOf(segments: { start: number; end: number; text: string; words?: { start: number; end: number }[] }[]): CaptionWord[] {
  return segments
    .flatMap((seg) => segmentWordTimes(seg))
    .filter((w) => splitWords(w.text).length > 0 && w.end >= w.start)
    .map((w) => ({ text: w.text.slice(0, 80), start: Math.round(w.start * 1000) / 1000, end: Math.round(w.end * 1000) / 1000 }));
}

/** Transcribe the sound that has waited longest. False when none is waiting. */
export async function captionNext(signal?: AbortSignal, now = Date.now()): Promise<boolean> {
  const sql = db();
  const [row] = await sql<{ id: string; user_id: string; language: string | null; duration_sec: number; attempts: number }[]>`
    update caption_jobs set status = 'working', attempts = attempts + 1, lease_until = ${now + LEASE_MS}, progress = 0
    where id = (
      select id from caption_jobs where status = 'queued' or (status = 'working' and lease_until < ${now})
      order by created_at limit 1 for update skip locked
    )
    returning id, user_id, language, duration_sec, attempts`;
  if (!row) return false;
  const dir = dirOf(row.id);
  const fail = (message: string) => sql`update caption_jobs set status = 'failed', error = ${message}, lease_until = null, finished_at = ${Date.now()} where id = ${row.id}`;
  if (row.attempts > MAX_ATTEMPTS) {
    await fail("The captions couldn’t be made. Try again.");
    await rm(dir, { recursive: true, force: true });
    return true;
  }
  const beat = setInterval(() => void sql`update caption_jobs set lease_until = ${Date.now() + LEASE_MS} where id = ${row.id}`.catch(() => undefined), 30_000);
  try {
    let last = 0;
    const transcript = await transcribeLocal(path.join(dir, "sound.wav"), path.join(dir, "work"), row.language ?? undefined, signal ?? new AbortController().signal, (value) => {
      if (Date.now() - last < 2000) return;
      last = Date.now();
      void sql`update caption_jobs set progress = ${Math.min(0.99, value)} where id = ${row.id}`.catch(() => undefined);
    });
    const words = wordsOf(transcript.segments);
    await sql`update caption_jobs set status = 'ready', progress = 1, result = ${sql.json({ words, language: transcript.language ?? null })}, lease_until = null, finished_at = ${Date.now()} where id = ${row.id}`;
    await recordUsage(row.user_id, `captions:${row.id}`, Number(row.duration_sec));
    await rm(dir, { recursive: true, force: true });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) {
      await sql`update caption_jobs set status = 'queued', attempts = greatest(0, attempts - 1), lease_until = null where id = ${row.id}`;
    } else if (err instanceof HttpError && err.status < 500) {
      await fail(err.message);
      await rm(dir, { recursive: true, force: true });
    } else if (row.attempts < MAX_ATTEMPTS) {
      console.error(`[bamio/captions] ${row.id} failed (attempt ${row.attempts}), trying again:`, err);
      await sql`update caption_jobs set status = 'queued', lease_until = null where id = ${row.id}`;
    } else {
      reportError(err, "editor captions failed", { jobId: row.id });
      await fail("Something went wrong on our side. Try again.");
      await rm(dir, { recursive: true, force: true });
    }
  } finally {
    clearInterval(beat);
  }
  return true;
}

/** Forget jobs a day old, and any sound still left of them. */
export async function sweepCaptions(now = Date.now()): Promise<void> {
  const gone = await db()<{ id: string }[]>`delete from caption_jobs where created_at < ${now - 24 * HOUR} returning id`;
  for (const g of gone) await rm(dirOf(g.id), { recursive: true, force: true });
}

/** A user's jobs and their sound (deleting the account). */
export async function deleteCaptionsOf(userId: string): Promise<void> {
  const gone = await db()<{ id: string }[]>`delete from caption_jobs where user_id = ${userId} returning id`;
  for (const g of gone) await rm(dirOf(g.id), { recursive: true, force: true });
}

export type Captioner = { stop: () => Promise<void> };

/** Transcribes captions as they're asked for, one at a time; sweeps every hour. BAMIO_CAPTIONS=off: not in this process. */
export function startCaptioner(opts: { pollMs?: number; log?: (m: string) => void } = {}): Captioner {
  if (process.env.BAMIO_CAPTIONS === "off") return { stop: async () => undefined };
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
          while (!stopping && (await captionNext(stopper.signal))) {
            // The next one.
          }
        } catch (err) {
          if (!stopping && Date.now() >= quietUntil) {
            log(`[bamio/captions] ${id} can't make captions: ${err instanceof Error ? err.message : String(err)}`);
            quietUntil = Date.now() + 60_000;
          }
        }
      } while (again && !stopping);
    })().finally(() => {
      running = null;
    });
  }
  const listening = db()
    .listen(CAPTIONS_CHANNEL, () => kick())
    .catch(() => null);
  const poll = setInterval(kick, opts.pollMs ?? 30_000);
  const tidy = setInterval(() => void sweepCaptions().catch(() => undefined), HOUR);
  poll.unref?.();
  tidy.unref?.();
  kick();
  return {
    async stop() {
      stopping = true;
      clearInterval(poll);
      clearInterval(tidy);
      stopper.abort();
      await (await listening)?.unlisten().catch(() => undefined);
      await running;
    },
  };
}
