import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/server/db";
import { deliverNext, emailRetryDelay, emailSetup, MAX_EMAIL_ATTEMPTS, queueEmail, SendError, type MailerDeps, type OutgoingEmail, type Recipient } from "@/lib/server/email";
import { EMAIL_CATEGORY, EMAIL_TOKENS, renderEmail, type Email, type EmailTemplate } from "@/lib/email/templates";
import { DEFAULT_NOTIFICATIONS, readNotifications } from "@/lib/profile/notifications";

const DAY = Date.UTC(2027, 2, 3, 12);

const READY: Extract<Email, { template: "video-ready" }> = {
  template: "video-ready",
  projectId: "4f1c3a52-0d7e-4b8e-9a37-1f2b3c4d5e6f",
  title: "Podcast, episode 112",
  stream: false,
  durationSec: 1260,
  captioned: true,
  clipCount: 7,
  clips: [
    { title: "The one habit that changed everything", score: 94, start: 312 },
    { title: "Why most advice is wrong", score: 88, start: 845.5 },
    { title: "Start before you're ready", score: 81, start: 1102 },
  ],
};
const FAILED: Extract<Email, { template: "video-failed" }> = {
  template: "video-failed",
  projectId: "4f1c3a52-0d7e-4b8e-9a37-1f2b3c4d5e6f",
  title: "Live from the studio",
  error: "That video is longer than 3 hours. Import a part of it instead.",
};

/** One of every email, with the kind of data the app queues. */
const SAMPLES: Record<EmailTemplate, Email> = {
  "ops-alert": { template: "ops-alert", title: "3 jobs failed in the last hour", lines: ["import 12: It took too long."], path: "/admin/jobs?view=failed" },
  "plan-started": { template: "plan-started", plan: "pro", interval: "month", renewsAt: DAY },
  "plan-changed": { template: "plan-changed", from: "starter", fromInterval: "month", plan: "team", interval: "quarter" },
  "plan-ending": { template: "plan-ending", plan: "pro", endsAt: DAY },
  "plan-resumed": { template: "plan-resumed", plan: "pro", renewsAt: DAY },
  "payment-failed": { template: "payment-failed", plan: "starter" },
  "plan-ended": { template: "plan-ended", plan: "team" },
  "minutes-low": { template: "minutes-low", plan: "pro", usedMin: 324, allowanceMin: 400, resetsAt: DAY },
  "minutes-out": { template: "minutes-out", plan: "starter", allowanceMin: 150, resetsAt: DAY },
  "video-ready": READY,
  "video-failed": FAILED,
  "referral-earned": { template: "referral-earned", amountCents: 500, onBalance: true },
};

describe("email templates", () => {
  const appUrl = "https://bamio.example.com";

  it("write every email, with links to the site", () => {
    for (const sample of Object.values(SAMPLES)) {
      const { subject, html, text } = renderEmail(sample, { appUrl });
      expect(subject.length).toBeGreaterThan(5);
      expect(html).toContain("<!doctype html>");
      expect(html).toContain(`href="${appUrl}/`);
      expect(text).toContain(`${appUrl}/`);
      // Bamio's voice: no em dashes, anywhere.
      expect(`${subject}${html}${text}`).not.toContain("—");
    }
    const ready = renderEmail(SAMPLES["video-ready"], { appUrl });
    expect(ready.subject).toBe("Your clips are ready: “Podcast, episode 112”");
    expect(ready.html).toContain(`href="${appUrl}/projects/4f1c3a52-0d7e-4b8e-9a37-1f2b3c4d5e6f"`);
    expect(ready.text).toContain("- The one habit that changed everything (Score 94 · at 5:12)");
    expect(renderEmail(SAMPLES["plan-started"], { appUrl }).text).toContain("400 AI minutes a month, up to 150 projects kept and priority processing");
    expect(renderEmail(SAMPLES["plan-ending"], { appUrl }).subject).toBe("Your Bamio Pro plan ends on March 3, 2027");
  });

  it("let people turn off video and minutes emails, never plan emails", () => {
    for (const sample of Object.values(SAMPLES)) {
      const { html, text } = renderEmail(sample, { appUrl });
      const optional = EMAIL_CATEGORY[sample.template] !== "account";
      expect(html.includes(`${appUrl}/profile/notifications`)).toBe(optional);
      expect(text.includes(`${appUrl}/profile/notifications`)).toBe(optional);
    }
  });

  it("escape what users and videos named", () => {
    const { subject, html } = renderEmail({ ...READY, title: `<img src=x onerror="alert(1)"> & "friends"`, clips: [{ title: "<b>bold</b>", start: 1 }], clipCount: 1 }, { appUrl });
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &quot;friends&quot;");
    expect(subject).toContain(`<img src=x onerror="alert(1)">`); // a subject is plain text
    const long = renderEmail({ ...FAILED, title: `${"a very long title ".repeat(10)}\nwith a line break` }, { appUrl });
    expect(long.subject.length).toBeLessThanOrEqual(80);
    expect(long.subject).not.toContain("\n");
  });

  it("say what was found, or that the video is ready to clip by hand", () => {
    const none = renderEmail({ ...READY, captioned: false, clipCount: 0, clips: [], warning: "No speech was found, so there are no captions or AI clips." }, { appUrl });
    expect(none.subject).toBe("Your video is ready: “Podcast, episode 112”");
    expect(none.text).toContain("Note: No speech was found");
    expect(none.text).toContain("is imported.");
    expect(none.text).toContain("Bamio cuts them.");
    const stream = renderEmail({ ...READY, stream: true, clipCount: 1, clips: READY.clips.slice(0, 1) }, { appUrl });
    expect(stream.text).toContain("is captured and captioned");
    expect(stream.subject).toBe("Your clips are ready: “Podcast, episode 112”");
  });

  it("use the design tokens' colours and radii", () => {
    const css = readFileSync("src/styles/tokens.css", "utf8");
    const block = (start: string) => {
      const from = css.indexOf(start);
      return css.slice(from, css.indexOf("}", from));
    };
    const value = (text: string, name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(text)?.[1]?.trim();
    const paper = block(":root {");
    const night = block(':root[data-theme="night"],');
    for (const [name, v] of Object.entries(EMAIL_TOKENS.paper)) expect([name, value(paper, name)]).toEqual([name, v]);
    for (const [name, v] of Object.entries(EMAIL_TOKENS.night)) expect([name, value(night, name)]).toEqual([name, v]);
    for (const [name, v] of Object.entries({ ...EMAIL_TOKENS.brand, ...EMAIL_TOKENS.radius })) expect([name, value(paper, name)]).toEqual([name, v]);
  });
});

describe("notification settings", () => {
  it("default to on, field by field", () => {
    expect(readNotifications(undefined)).toEqual(DEFAULT_NOTIFICATIONS);
    expect(readNotifications({ bamioNotifications: { videos: false } })).toEqual({ videos: false, minutes: true });
    expect(readNotifications({ bamioNotifications: { videos: "no", minutes: false } })).toEqual({ videos: true, minutes: false });
  });
});

describe("the email outbox", () => {
  const user = "user_mail1";
  const ENV = ["BAMIO_EMAIL", "RESEND_API_KEY", "EMAIL_FROM", "BAMIO_APP_URL"] as const;
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

  /** A fake Resend and Clerk: what was sent, and who the user is. */
  function fakes(recipient: Recipient = { address: "ana@example.com", notifications: { videos: true, minutes: true } }) {
    const sent: OutgoingEmail[] = [];
    let fail: SendError | null = null;
    const deps: MailerDeps = {
      recipient: async () => recipient,
      send: async (email) => {
        if (fail) throw fail;
        sent.push(email);
        return { id: `re_${sent.length}` };
      },
    };
    return { deps, sent, failWith: (err: SendError | null) => (fail = err) };
  }
  const rows = () => db()<{ key: string; status: string; attempts: number; to_address: string | null; subject: string | null; provider_id: string | null; last_error: string | null; run_after: number }[]>`
    select key, status, attempts, to_address, subject, provider_id, last_error, run_after::float8 as run_after from emails where user_id = ${user} order by id`;
  const drain = async (deps: MailerDeps, now?: number) => {
    while (await deliverNext(deps, () => undefined, now)) {
      // Next.
    }
  };

  beforeEach(async () => {
    process.env.RESEND_API_KEY = "re_unit_fake";
    process.env.EMAIL_FROM = "Bamio <hello@bamio.example.com>";
    process.env.BAMIO_APP_URL = "https://bamio.example.com/";
    delete process.env.BAMIO_EMAIL;
    await db()`delete from emails`;
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  afterAll(async () => {
    await db()`delete from emails`;
  });

  it("is on with a Resend key and a sender, and says what's missing", () => {
    expect(emailSetup()).toEqual({ mode: "send" });
    delete process.env.EMAIL_FROM;
    expect(emailSetup()).toEqual({ mode: "off", missing: "EMAIL_FROM" });
    process.env.BAMIO_EMAIL = "preview";
    expect(emailSetup()).toEqual({ mode: "preview" });
    process.env.BAMIO_EMAIL = "off";
    expect(emailSetup()).toEqual({ mode: "off" });
  });

  it("queues each email once, and sends it with an idempotency key", async () => {
    expect(await queueEmail(user, "video-ready:p1", SAMPLES["video-ready"])).toBe(true);
    expect(await queueEmail(user, "video-ready:p1", SAMPLES["video-ready"])).toBe(false);
    const { deps, sent } = fakes();
    await drain(deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "ana@example.com", subject: "Your clips are ready: “Podcast, episode 112”", template: "video-ready", idempotencyKey: expect.stringMatching(/^bamio-email-\d+$/) });
    expect(sent[0]!.html).toContain('href="https://bamio.example.com/projects/');
    expect(await rows()).toMatchObject([{ key: "video-ready:p1", status: "sent", attempts: 1, to_address: "ana@example.com", provider_id: "re_1" }]);
    // Queuing it again after it went out sends nothing.
    expect(await queueEmail(user, "video-ready:p1", SAMPLES["video-ready"])).toBe(false);
    await drain(deps);
    expect(sent).toHaveLength(1);
  });

  it("skips what the user turned off (never plan emails), users without an address, and Clerk test users", async () => {
    await queueEmail(user, "a", SAMPLES["video-ready"]);
    await queueEmail(user, "b", SAMPLES["minutes-low"]);
    await queueEmail(user, "c", SAMPLES["payment-failed"]);
    const off = fakes({ address: "ana@example.com", notifications: { videos: false, minutes: false } });
    await drain(off.deps);
    expect(off.sent.map((e) => e.template)).toEqual(["payment-failed"]);
    expect((await rows()).map((r) => [r.key, r.status, r.last_error])).toEqual([
      ["a", "skipped", "Turned off in Notifications."],
      ["b", "skipped", "Turned off in Notifications."],
      ["c", "sent", null],
    ]);

    await queueEmail(user, "d", SAMPLES["plan-ended"]);
    await drain(fakes(null).deps);
    await queueEmail(user, "e", SAMPLES["plan-ended"]);
    const test = fakes({ address: "e2e+clerk_test@example.com", notifications: DEFAULT_NOTIFICATIONS });
    await drain(test.deps);
    expect(test.sent).toHaveLength(0);
    expect((await rows()).slice(3).map((r) => [r.key, r.status])).toEqual([
      ["d", "skipped"],
      ["e", "skipped"],
    ]);
  });

  it("tries again later when Resend or Clerk can't be reached, and gives up on a refusal", async () => {
    const { deps, sent, failWith } = fakes();
    await queueEmail(user, "retry", SAMPLES["plan-started"]);
    failWith(new SendError("Resend couldn't be reached", true));
    const now = Date.now();
    await drain(deps, now);
    let [row] = await rows();
    expect(row).toMatchObject({ status: "queued", attempts: 1, last_error: "Resend couldn't be reached" });
    expect(row!.run_after).toBeGreaterThanOrEqual(now + emailRetryDelay(1));
    // Not due yet: nothing happens.
    await drain(deps, now + 1000);
    expect((await rows())[0]!.attempts).toBe(1);
    // Due: it goes out.
    failWith(null);
    await drain(deps, row!.run_after + 1);
    [row] = await rows();
    expect(row).toMatchObject({ status: "sent", attempts: 2 });
    expect(sent).toHaveLength(1);

    await queueEmail(user, "refused", SAMPLES["plan-ended"]);
    failWith(new SendError("Resend refused it (validation_error, 422)", false));
    await drain(deps);
    expect((await rows())[1]).toMatchObject({ status: "failed", attempts: 1 });

    // Retries stop after the last attempt.
    await queueEmail(user, "flaky", SAMPLES["plan-ended"]);
    failWith(new SendError("down", true));
    let at = Date.now();
    for (let i = 0; i < MAX_EMAIL_ATTEMPTS + 2; i++) {
      await drain(deps, at);
      at += 4 * 3600_000;
    }
    expect((await rows())[2]).toMatchObject({ status: "failed", attempts: MAX_EMAIL_ATTEMPTS });
  });

  it("takes over an email whose sender stopped mid-send", async () => {
    await queueEmail(user, "stuck", SAMPLES["plan-started"]);
    await db()`update emails set status = 'sending', attempts = 1, lease_until = ${Date.now() - 1} where user_id = ${user}`;
    const { deps, sent } = fakes();
    await drain(deps);
    expect(sent).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("previews instead of sending with BAMIO_EMAIL=preview, and queues nothing with emails off", async () => {
    process.env.BAMIO_EMAIL = "preview";
    await queueEmail(user, "preview", SAMPLES["minutes-out"]);
    const { deps, sent } = fakes();
    await drain(deps);
    expect(sent).toHaveLength(0);
    expect((await rows())[0]).toMatchObject({ status: "previewed", to_address: "ana@example.com", subject: "You’ve used this month’s AI minutes" });

    process.env.BAMIO_EMAIL = "off";
    expect(await queueEmail(user, "off", SAMPLES["minutes-out"])).toBe(false);
    expect(await rows()).toHaveLength(1);
  });
});
