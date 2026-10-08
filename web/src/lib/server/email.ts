import "server-only";
import { CONTACT_EMAIL } from "@/lib/contact";
import { createClerkClient } from "@clerk/backend";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import { randomUUID } from "node:crypto";
import os from "node:os";
import type postgres from "postgres";
import { Resend } from "resend";
import { db, type Sql, type Tx } from "@/lib/server/db";
import { EMAIL_CATEGORY, emailSchema, renderEmail, type Email } from "@/lib/email/templates";
import { readNotifications, type Notifications } from "@/lib/profile/notifications";

/*
 * Emails to users, sent through Resend. This is the only module that reads RESEND_API_KEY.
 *
 * Code that has something to tell a user queues an email (`queueEmail`) with a key naming
 * what it's about; a key is used once per user, so the same news never goes out twice. Queue
 * it in the same transaction as the change it reports where there is one (billing.ts does).
 * The workers' mailer (`startMailer`, started with the job worker) sends what's queued: it
 * looks the user up in Clerk (their primary address, and whether they turned that kind of
 * email off), writes the email (src/lib/email/templates.ts) and sends it, retrying when Resend
 * or Clerk can't be reached. Each send carries an idempotency key, so a worker that dies
 * mid-send can't make it go out twice.
 *
 * BAMIO_EMAIL=off: nothing is queued (the test servers). BAMIO_EMAIL=preview: emails are
 * queued and written, then logged instead of sent (no Resend key needed).
 */

export type EmailMode = "send" | "preview" | "off";

/** Whether emails go out, and if they can't, what's missing. */
export function emailSetup(): { mode: EmailMode; missing?: string } {
  const setting = process.env.BAMIO_EMAIL;
  if (setting === "off") return { mode: "off" };
  if (setting === "preview") return { mode: "preview" };
  if (!process.env.RESEND_API_KEY) return { mode: "off", missing: "RESEND_API_KEY" };
  if (!process.env.EMAIL_FROM) return { mode: "off", missing: "EMAIL_FROM" };
  if (!appUrl()) return { mode: "off", missing: "BAMIO_APP_URL" };
  return { mode: "send" };
}

export const emailMode = () => emailSetup().mode;

/** The site's address, for links in emails: BAMIO_APP_URL (required in production). */
export function appUrl(): string | null {
  const url = process.env.BAMIO_APP_URL?.trim().replace(/\/+$/, "");
  if (url) return url;
  return process.env.NODE_ENV === "production" ? null : `http://localhost:${process.env.PORT || 3000}`;
}

export const EMAILS_CHANNEL = "bamio_emails";

/**
 * Queue an email to a user, once per `key` (later calls with the same key do nothing).
 * Returns true if it was queued now. Nothing is queued while emails are off.
 */
export async function queueEmail(userId: string, key: string, email: Email, sql: Sql | Tx = db(), now = Date.now()): Promise<boolean> {
  if (emailMode() === "off") return false;
  const data = emailSchema.parse(email);
  const rows = await sql`
    insert into emails (user_id, key, template, category, data, run_after, created_at, updated_at)
    values (${userId}, ${key}, ${data.template}, ${EMAIL_CATEGORY[data.template]}, ${sql.json(data as postgres.JSONValue)}, ${now}, ${now}, ${now})
    on conflict (user_id, key) do nothing
    returning id`;
  if (rows.length === 0) return false;
  await sql`select pg_notify(${EMAILS_CHANNEL}, '')`;
  return true;
}

/* ------------------------------ Sending ------------------------------ */

/** Where a user's emails go, and which they want. Null: the user is gone, or has no address. */
export type Recipient = { address: string; notifications: Notifications } | null;

export type OutgoingEmail = { to: string; subject: string; html: string; text: string; idempotencyKey: string; template: string };

/** A send that failed. `retry`: worth trying again later (network, rate limit, the provider down). */
export class SendError extends Error {
  constructor(
    message: string,
    readonly retry: boolean,
  ) {
    super(message);
  }
}

export type MailerDeps = {
  recipient(userId: string): Promise<Recipient>;
  send(email: OutgoingEmail): Promise<{ id: string }>;
};

let clerk: { key: string; client: ReturnType<typeof createClerkClient> } | null = null;

/** The user's primary address and notification settings, from Clerk. */
async function clerkRecipient(userId: string): Promise<Recipient> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) throw new SendError("CLERK_SECRET_KEY isn't set, so Bamio can't look up email addresses.", true);
  if (clerk?.key !== secretKey) clerk = { key: secretKey, client: createClerkClient({ secretKey }) };
  try {
    const user = await clerk.client.users.getUser(userId);
    const address = user.primaryEmailAddress?.emailAddress;
    return address ? { address, notifications: readNotifications(user.unsafeMetadata) } : null;
  } catch (err) {
    if (isClerkAPIResponseError(err) && err.status === 404) return null;
    throw new SendError(`Clerk didn't answer: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}

let resend: { key: string; client: Resend } | null = null;

async function resendSend(email: OutgoingEmail): Promise<{ id: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new SendError("RESEND_API_KEY isn't set.", false);
  if (resend?.key !== key) resend = { key, client: new Resend(key) };
  let result: Awaited<ReturnType<Resend["emails"]["send"]>>;
  try {
    result = await resend.client.emails.send(
      {
        from: process.env.EMAIL_FROM ?? "",
        to: email.to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        // Someone who answers an email reaches a person: the contact address, unless another is set.
        replyTo: process.env.EMAIL_REPLY_TO || CONTACT_EMAIL,
        tags: [{ name: "template", value: email.template }],
      },
      { idempotencyKey: email.idempotencyKey },
    );
  } catch (err) {
    throw new SendError(`Resend couldn't be reached: ${err instanceof Error ? err.message : String(err)}`, true);
  }
  if (result.error) {
    const { statusCode, name, message } = result.error;
    const retry = statusCode === null || statusCode === 429 || statusCode >= 500 || name === "concurrent_idempotent_requests";
    throw new SendError(`Resend refused it (${name}${statusCode ? `, ${statusCode}` : ""}): ${message}`, retry);
  }
  return { id: result.data.id };
}

export const defaultMailerDeps: MailerDeps = { recipient: clerkRecipient, send: resendSend };

/** Tries per email, and the wait before each retry: 1 min, 5 min, 20 min, 1 h, 3 h. */
export const MAX_EMAIL_ATTEMPTS = 6;
export const emailRetryDelay = (attempts: number) => [60_000, 5 * 60_000, 20 * 60_000, 3600_000, 3 * 3600_000][Math.min(attempts, 5) - 1] ?? 3 * 3600_000;
const LEASE_MS = 60_000;
const CLERK_TEST_ADDRESS = /\+clerk_test@/i;

type Row = { id: string | number; user_id: string; key: string; template: string; category: string; data: unknown; attempts: number };

/**
 * Send the next email that's due, if any (one at a time). Returns false when nothing was due.
 * Exported for the tests; the mailer calls it in a loop.
 */
export async function deliverNext(deps: MailerDeps = defaultMailerDeps, log: (m: string) => void = console.log, now = Date.now()): Promise<boolean> {
  const sql = db();
  const [row] = await sql<Row[]>`
    update emails set status = 'sending', attempts = attempts + 1, lease_until = ${now + LEASE_MS}, updated_at = ${now}
    where id = (
      select id from emails
      where (status = 'queued' and run_after <= ${now}) or (status = 'sending' and lease_until < ${now})
      order by run_after, id
      limit 1
      for update skip locked
    )
    returning id, user_id, key, template, category, data, attempts`;
  if (!row) return false;
  const id = Number(row.id);
  const finish = (status: "sent" | "previewed" | "skipped" | "failed", fields: { to?: string | null; subject?: string | null; providerId?: string | null; error?: string | null } = {}) =>
    sql`update emails set status = ${status}, lease_until = null, updated_at = ${Date.now()},
          to_address = ${fields.to ?? null}, subject = ${fields.subject ?? null}, provider_id = ${fields.providerId ?? null}, last_error = ${fields.error ?? null},
          sent_at = ${status === "sent" ? Date.now() : null}
        where id = ${id}`;

  const parsed = emailSchema.safeParse(row.data);
  if (!parsed.success) {
    await finish("failed", { error: "Its data doesn't match the template." });
    return true;
  }
  const email = parsed.data;
  const mode = emailMode();
  try {
    if (mode === "off") {
      await finish("skipped", { error: "Emails are off." });
      return true;
    }
    const rendered = renderEmail(email, { appUrl: appUrl() ?? "" });
    if (mode === "preview") {
      const to = await deps.recipient(row.user_id).catch(() => null);
      log(`[bamio/email] preview: "${rendered.subject}" to ${to?.address ?? row.user_id} (${row.key})`);
      await finish("previewed", { to: to?.address, subject: rendered.subject });
      return true;
    }
    const to = await deps.recipient(row.user_id);
    if (!to) {
      await finish("skipped", { subject: rendered.subject, error: "The user has no email address (or no account)." });
      return true;
    }
    // Clerk's test users (the end-to-end tests sign in as one) have addresses that receive nothing; sending would only bounce.
    if (CLERK_TEST_ADDRESS.test(to.address)) {
      await finish("skipped", { to: to.address, subject: rendered.subject, error: "A Clerk test address." });
      return true;
    }
    const category = EMAIL_CATEGORY[email.template];
    if (category !== "account" && !to.notifications[category]) {
      await finish("skipped", { to: to.address, subject: rendered.subject, error: "Turned off in Notifications." });
      return true;
    }
    const sent = await deps.send({ to: to.address, ...rendered, idempotencyKey: `bamio-email-${id}`, template: email.template });
    await finish("sent", { to: to.address, subject: rendered.subject, providerId: sent.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retry = !(err instanceof SendError) || err.retry;
    if (retry && row.attempts < MAX_EMAIL_ATTEMPTS) {
      const delay = emailRetryDelay(row.attempts);
      log(`[bamio/email] ${row.template} email ${id} failed (attempt ${row.attempts} of ${MAX_EMAIL_ATTEMPTS}), trying again in ${Math.round(delay / 60_000)} min: ${message}`);
      await sql`update emails set status = 'queued', lease_until = null, run_after = ${Date.now() + delay}, last_error = ${message}, updated_at = ${Date.now()} where id = ${id}`;
    } else {
      log(`[bamio/email] ${row.template} email ${id} failed: ${message}`);
      await finish("failed", { error: message });
    }
  }
  return true;
}

/** Old emails are forgotten after half a year (their keys only need to outlive the events that cause them). */
export async function pruneEmails(days = 180, now = Date.now()) {
  await db()`delete from emails where status not in ('queued', 'sending') and updated_at < ${now - days * 86_400_000}`;
}

export type Mailer = { stop(): Promise<void> };

/** Send queued emails until stopped: woken when one is queued, polling as a fallback. One per process is enough. */
export function startMailer(deps: MailerDeps = defaultMailerDeps, opts: { pollMs?: number; log?: (m: string) => void } = {}): Mailer {
  const log = opts.log ?? ((m: string) => console.log(m));
  const id = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const setup = emailSetup();
  if (setup.missing) log(`[bamio/email] emails are off: set ${setup.missing} to send them`);
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
          while (!stopping && (await deliverNext(deps, log))) {
            // Next one.
          }
        } catch (err) {
          // The database is unreachable: say so once a minute, and try again on the next poll.
          if (Date.now() >= quietUntil) {
            log(`[bamio/email] ${id} can't send emails: ${err instanceof Error ? err.message : String(err)}`);
            quietUntil = Date.now() + 60_000;
          }
        }
      } while (again && !stopping);
    })().finally(() => {
      running = null;
    });
  }

  const listening = db()
    .listen(EMAILS_CHANNEL, () => kick())
    .catch(() => null);
  const poll = setInterval(kick, opts.pollMs ?? 15_000);
  const prune = setInterval(() => void pruneEmails().catch(() => undefined), 6 * 3600_000);
  poll.unref?.();
  prune.unref?.();
  kick();

  return {
    async stop() {
      stopping = true;
      clearInterval(poll);
      clearInterval(prune);
      await (await listening)?.unlisten().catch(() => undefined);
      await running;
    },
  };
}
