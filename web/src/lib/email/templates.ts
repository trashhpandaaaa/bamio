import { z } from "zod";
import { formatPrice, intervalSchema, PLANS, planIdSchema, type Interval, type PlanId } from "@/lib/billing/plans";
import { formatSpan } from "@/lib/clips/live";
import { TOKENS } from "@/lib/brand-tokens";
import { formatTimecode } from "@/lib/clips/logic";

/*
 * The emails Bamio sends, as data (what's stored in the emails outbox) and how each one is
 * written (subject, HTML and plain text). Sent by src/lib/server/email.ts. Everything here is
 * plain rendering, so the tests can render every email.
 */

const clipSchema = z.object({ title: z.string(), score: z.number().optional(), start: z.number() });

export const emailSchema = z.discriminatedUnion("template", [
  z.object({ template: z.literal("plan-started"), plan: planIdSchema, interval: intervalSchema, renewsAt: z.number() }),
  z.object({ template: z.literal("plan-changed"), from: planIdSchema, fromInterval: intervalSchema, plan: planIdSchema, interval: intervalSchema }),
  z.object({ template: z.literal("plan-ending"), plan: planIdSchema, endsAt: z.number() }),
  z.object({ template: z.literal("plan-resumed"), plan: planIdSchema, renewsAt: z.number() }),
  z.object({ template: z.literal("payment-failed"), plan: planIdSchema }),
  z.object({ template: z.literal("plan-ended"), plan: planIdSchema }),
  z.object({ template: z.literal("minutes-low"), plan: planIdSchema, usedMin: z.number(), allowanceMin: z.number(), resetsAt: z.number() }),
  z.object({ template: z.literal("minutes-out"), plan: planIdSchema, allowanceMin: z.number(), resetsAt: z.number() }),
  z.object({
    template: z.literal("video-ready"),
    projectId: z.string(),
    title: z.string(),
    stream: z.boolean(),
    durationSec: z.number(),
    /** It has a transcript (there was speech to caption). */
    captioned: z.boolean(),
    clipCount: z.number(),
    /** The best AI clips, at most three. */
    clips: z.array(clipSchema).max(3),
    warning: z.string().optional(),
  }),
  z.object({ template: z.literal("video-failed"), projectId: z.string(), title: z.string(), error: z.string() }),
  /** A friend the user referred made their first payment. `onBalance`: the credit is on their Stripe balance (else it waits for their first plan). */
  z.object({ template: z.literal("referral-earned"), amountCents: z.number().int().positive(), onBalance: z.boolean() }),
  /** Bamio paid the user for their clips in a campaign, and an admin wrote it down (src/lib/server/campaigns.ts). `brand`: whose campaign it is. */
  z.object({ template: z.literal("campaign-paid"), campaign: z.string().max(120), brand: z.string().max(80), slug: z.string().max(80), amountCents: z.number().int().positive(), note: z.string().max(300) }),
  /** The campaign someone asked to run (src/lib/server/campaign-requests.ts) is open to clippers. */
  z.object({ template: z.literal("campaign-live"), campaign: z.string().max(120), slug: z.string().max(80) }),
  /** A request to run a campaign was declined, with the team's word why. */
  z.object({ template: z.literal("campaign-declined"), name: z.string().max(80), note: z.string().max(300) }),
  /** To superadmins (src/lib/server/alerts.ts): jobs failing, the queue backing up, an account that won't delete. */
  z.object({ template: z.literal("ops-alert"), title: z.string().max(120), lines: z.array(z.string().max(500)).max(10), path: z.string().startsWith("/") }),
]);

export type Email = z.infer<typeof emailSchema>;
export type EmailTemplate = Email["template"];

/** Who may turn an email off: account emails (plan, payments) always go out; the others follow the user's notification settings. */
export type EmailCategory = "account" | "videos" | "minutes";

export const EMAIL_CATEGORY: Record<EmailTemplate, EmailCategory> = {
  "plan-started": "account",
  "plan-changed": "account",
  "plan-ending": "account",
  "plan-resumed": "account",
  "payment-failed": "account",
  "plan-ended": "account",
  "minutes-low": "minutes",
  "minutes-out": "minutes",
  "video-ready": "videos",
  "video-failed": "videos",
  "referral-earned": "account",
  "ops-alert": "account",
  "campaign-paid": "account",
  "campaign-live": "account",
  "campaign-declined": "account",
};

/** The design tokens emails use (lib/brand-tokens.ts). */
export const EMAIL_TOKENS = TOKENS;

const P = EMAIL_TOKENS.paper;
const N = EMAIL_TOKENS.night;
const VOLT = EMAIL_TOKENS.brand["--volt"];
const R = EMAIL_TOKENS.radius;
/** Bricolage where the reader has it (it's rarely there in mail apps), else the system's sans. */
const FONT = `'Bricolage Grotesque',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

/* ------------------------------ Writing ------------------------------ */

type Block = { p: string } | { list: { title: string; meta: string }[] } | { note: string };

type Draft = {
  subject: string;
  /** The line mail apps show after the subject. */
  preview: string;
  heading: string;
  blocks: Block[];
  button: { label: string; path: string };
  /** A quieter second link under the button. */
  more?: { text: string; label: string; path: string };
};

const planName = (plan: PlanId) => PLANS[plan].name;
const every = (interval: Interval) => (interval === "month" ? "every month" : "every 3 months");
const count = (n: number) => n.toLocaleString("en-US");
const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
/** A title inside a subject line: one line, not too long. */
const short = (title: string, max = 60) => {
  const line = title.replace(/\s+/g, " ").trim() || "Untitled video";
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};
const upgradeOr = (plan: PlanId): Draft["button"] => (plan === "team" ? { label: "Open Billing", path: "/billing" } : { label: "See plans", path: "/pricing" });

function perks(plan: PlanId): string {
  const p = PLANS[plan];
  const parts = [`${count(p.minutes)} AI minutes a month`, `up to ${count(p.projects)} projects kept`];
  if (p.priority > 0) parts.push("priority processing");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function draft(email: Email): Draft {
  switch (email.template) {
    case "plan-started": {
      const name = planName(email.plan);
      return {
        subject: `Welcome to Bamio ${name}`,
        preview: `Your plan is active: ${count(PLANS[email.plan].minutes)} AI minutes a month.`,
        heading: `You’re on Bamio ${name}`,
        blocks: [
          { p: `Thanks for subscribing. Your ${name} plan is active now, billed ${every(email.interval)}.` },
          { p: `It comes with ${perks(email.plan)}. Your next payment is on ${day(email.renewsAt)}.` },
        ],
        button: { label: "Import a video", path: "/new" },
        more: { text: "Your plan, card and invoices are in", label: "Billing", path: "/billing" },
      };
    }
    case "plan-changed": {
      const name = planName(email.plan);
      const samePlan = email.from === email.plan;
      return {
        subject: samePlan ? `Your Bamio ${name} plan is now billed ${every(email.interval)}` : `Your Bamio plan is now ${name}`,
        preview: samePlan ? `Same plan, billed ${every(email.interval)}.` : `${count(PLANS[email.plan].minutes)} AI minutes a month from now on.`,
        heading: samePlan ? `You’re billed ${every(email.interval)} now` : `You’re on ${name} now`,
        blocks: samePlan
          ? [{ p: `Your ${name} plan stays the same, and it’s billed ${every(email.interval)} from now on.` }]
          : [{ p: `You switched from ${planName(email.from)} to ${name}, billed ${every(email.interval)}.` }, { p: `Your plan comes with ${perks(email.plan)}.` }],
        button: { label: "Open Billing", path: "/billing" },
      };
    }
    case "plan-ending": {
      const name = planName(email.plan);
      const when = day(email.endsAt);
      return {
        subject: `Your Bamio ${name} plan ends on ${when}`,
        preview: "Everything keeps working until then.",
        heading: `Your plan ends on ${when}`,
        blocks: [
          { p: `You cancelled your ${name} plan. Everything keeps working until ${when}, and your projects stay after that.` },
          { p: "Changed your mind? You can keep your plan from Billing before it ends." },
        ],
        button: { label: "Keep my plan", path: "/billing" },
      };
    }
    case "plan-resumed": {
      const name = planName(email.plan);
      return {
        subject: `Your Bamio ${name} plan continues`,
        preview: `Your next payment is on ${day(email.renewsAt)}.`,
        heading: "Your plan continues",
        blocks: [{ p: `You’re staying on ${name}. Your next payment is on ${day(email.renewsAt)}.` }],
        button: { label: "Open Billing", path: "/billing" },
      };
    }
    case "payment-failed": {
      const name = planName(email.plan);
      return {
        subject: `We couldn’t charge your card for Bamio ${name}`,
        preview: "Update your card to keep your plan.",
        heading: "Your payment didn’t go through",
        blocks: [
          { p: `We tried to renew your ${name} plan, and the payment was declined.` },
          { p: "Your plan keeps working while Stripe tries again over the next few days. Update your card to keep it." },
        ],
        button: { label: "Update your card", path: "/billing" },
      };
    }
    case "plan-ended": {
      const name = planName(email.plan);
      return {
        subject: `Your Bamio ${name} plan has ended`,
        preview: "Your projects and exports are still here.",
        heading: "Your plan has ended",
        blocks: [
          { p: `Your ${name} plan isn’t active anymore. Your projects and exports are still here, and you can edit and download them.` },
          { p: "To import new videos and find clips with AI, choose a plan." },
        ],
        button: { label: "See plans", path: "/pricing" },
      };
    }
    case "minutes-low":
      return {
        subject: `You’ve used ${count(email.usedMin)} of your ${count(email.allowanceMin)} AI minutes`,
        preview: `More arrive on ${day(email.resetsAt)}.`,
        heading: "Most of this month’s AI minutes are used",
        blocks: [
          { p: `You’ve used ${count(email.usedMin)} of the ${count(email.allowanceMin)} AI minutes on your ${planName(email.plan)} plan this month. More arrive on ${day(email.resetsAt)}.` },
          { p: "Until then, importing a part of a long video uses only that part’s minutes." },
        ],
        button: upgradeOr(email.plan),
      };
    case "minutes-out":
      return {
        subject: "You’ve used this month’s AI minutes",
        preview: `New imports can start again on ${day(email.resetsAt)}.`,
        heading: "This month’s AI minutes are used up",
        blocks: [
          { p: `You’ve used all ${count(email.allowanceMin)} AI minutes on your ${planName(email.plan)} plan. New imports can start again on ${day(email.resetsAt)}, when your minutes renew.` },
          { p: "Editing, exporting and downloading the clips you have still work." },
        ],
        button: email.plan === "team" ? { label: "Open Billing", path: "/billing" } : { label: "Upgrade for more minutes", path: "/pricing" },
      };
    case "video-ready": {
      const what = email.stream ? "stream" : "video";
      const found = email.clipCount > 0;
      const done = `${email.stream ? "captured" : "imported"}${email.captioned ? " and captioned" : ""}`;
      const blocks: Block[] = [{ p: `“${email.title}” (${formatSpan(email.durationSec)}) is ${done}.` }];
      if (found) {
        blocks.push({ p: email.clipCount > email.clips.length ? "The best ones:" : `${email.clipCount === 1 ? "It’s" : "They’re"} ready to edit and export:` });
        blocks.push({
          list: email.clips.map((c) => ({ title: c.title || "Untitled clip", meta: [c.score !== undefined ? `Score ${Math.round(c.score)}` : null, `at ${formatTimecode(c.start)}`].filter(Boolean).join(" · ") })),
        });
      } else {
        blocks.push({ p: `Mark the moments you want, and Bamio cuts${email.captioned ? " and captions" : ""} them.` });
      }
      if (email.warning) blocks.push({ note: email.warning });
      return {
        subject: found ? `Your clips are ready: “${short(email.title)}”` : `Your ${what} is ready: “${short(email.title)}”`,
        preview: found ? `Bamio found ${count(email.clipCount)} ${email.clipCount === 1 ? "clip" : "clips"}.` : `Ready to clip.`,
        heading: found ? `Bamio found ${count(email.clipCount)} ${email.clipCount === 1 ? "clip" : "clips"}` : `Your ${what} is ready`,
        blocks,
        button: { label: found ? "Open your clips" : `Open the ${what}`, path: `/projects/${email.projectId}` },
      };
    }
    case "video-failed":
      return {
        subject: `Couldn’t import “${short(email.title)}”`,
        preview: email.error,
        heading: "This import didn’t work",
        blocks: [{ p: `Bamio couldn’t import “${email.title}”. ${email.error}` }, { p: "Open the project to try again. Uploading the file also works when a site won’t share it." }],
        button: { label: "Open the project", path: `/projects/${email.projectId}` },
      };
    case "referral-earned": {
      const amount = formatPrice(email.amountCents);
      return {
        subject: `You earned ${amount} on Bamio`,
        preview: email.onBalance ? "It comes off your next bill." : "It comes off your first bill when you choose a plan.",
        heading: "A friend you referred subscribed",
        blocks: [
          { p: `Thanks for sharing Bamio. Your friend’s first payment went through, so you’ve earned ${amount}.` },
          {
            p: email.onBalance
              ? "It’s on your Bamio balance and comes off your next bill automatically."
              : "It’s saved for you and comes off your first bill when you choose a plan.",
          },
        ],
        button: email.onBalance ? { label: "Share your link again", path: "/billing#refer" } : { label: "See plans", path: "/pricing" },
      };
    }
    case "campaign-paid": {
      const amount = formatPrice(email.amountCents);
      return {
        subject: `Bamio paid you ${amount} for your clips`,
        preview: `For “${short(email.campaign)}”. Check that it arrived.`,
        heading: `${amount} paid for your clips`,
        blocks: [
          { p: `Bamio sent you ${amount} for your clips in “${email.campaign}”, ${email.brand}’s campaign.${email.note ? ` A note with it: ${email.note}` : ""}` },
          { p: "It was sent the way you asked under Profile, Clipper details. If it doesn’t arrive, reply to this email and we’ll look into it." },
        ],
        button: { label: "See your clips and earnings", path: `/clippers/${email.slug}` },
      };
    }
    case "campaign-live":
      return {
        subject: `Your campaign “${short(email.campaign)}” is live`,
        preview: "Clippers with a Bamio plan can join it now.",
        heading: "Your campaign is live",
        blocks: [
          { p: `“${email.campaign}” is open on Bamio: clippers with a Bamio plan can join it, clip your content and post it on their own channels.` },
          { p: "We look at every clip before it counts and keep the count of views. You pay Bamio for what the clips earn, up to your budget, and Bamio pays the clippers. We’ll write to you with what has been earned." },
          { p: "Share the campaign’s page with your audience: your own fans often make the best clippers. They’ll need a Bamio plan to open it and join." },
        ],
        button: { label: "See your campaign", path: `/clippers/${email.slug}` },
      };
    case "campaign-declined":
      return {
        subject: `About your campaign for ${short(email.name)}`,
        preview: "We couldn’t open it as it is.",
        heading: "We couldn’t open your campaign",
        blocks: [
          { p: `Thanks for asking to run a campaign for ${email.name}. We couldn’t open it as it is.${email.note ? ` ${email.note}` : ""}` },
          { p: "You’re welcome to change it and send it again from the Clippers page." },
        ],
        button: { label: "Run a campaign", path: "/clippers?run=1" },
      };
    case "ops-alert":
      return {
        subject: `Bamio alert: ${email.title}`,
        preview: email.lines[0] ?? email.title,
        heading: email.title,
        blocks: email.lines.map((line) => ({ p: line })),
        button: { label: "Open the admin panel", path: email.path },
      };
  }
}

const FOOTER: Record<EmailCategory, { text: string; link?: string }> = {
  account: { text: "You’re getting this because it’s about your Bamio account." },
  videos: { text: "You get these emails when a video is ready or an import fails. Turn them off in", link: "Notifications" },
  minutes: { text: "You get these emails when your AI minutes run low. Turn them off in", link: "Notifications" },
};

/* ------------------------------ Rendering ------------------------------ */

export type RenderedEmail = { subject: string; html: string; text: string };

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** One email, written out. `appUrl`: the site's address, for links. */
export function renderEmail(email: Email, opts: { appUrl: string }): RenderedEmail {
  const d = draft(email);
  const base = opts.appUrl.replace(/\/+$/, "");
  const url = (path: string) => `${base}${path}`;
  const footer = FOOTER[EMAIL_CATEGORY[email.template]];
  const settings = url("/profile/notifications");

  const body = d.blocks
    .map((b) => {
      if ("p" in b) return `<p class="t2" style="margin:0 0 16px;font:400 16px/1.5 ${FONT};color:${P["--text-secondary"]};">${escape(b.p)}</p>`;
      if ("note" in b)
        return `<p class="note" style="margin:0 0 16px;padding:12px 14px;border-radius:${R["--r-sm"]};background:${P["--warning-bg"]};font:400 14px/1.45 ${FONT};color:${P["--warning"]};">${escape(b.note)}</p>`;
      const rows = b.list
        .map(
          (item) =>
            `<tr><td class="line" style="padding:12px 0;border-top:1px solid ${P["--line"]};"><div class="t1" style="font:600 16px/1.35 ${FONT};color:${P["--text"]};">${escape(item.title)}</div><div class="t3" style="margin-top:2px;font:400 13px/1.4 ${FONT};color:${P["--text-tertiary"]};">${escape(item.meta)}</div></td></tr>`,
        )
        .join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-collapse:collapse;">${rows}</table>`;
    })
    .join("\n");

  const button = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 0;"><tr><td style="border-radius:${R["--r-pill"]};background:${VOLT};border:1px solid ${P["--volt-edge"]};"><a href="${escape(url(d.button.path))}" style="display:inline-block;padding:13px 22px;font:600 16px/1 ${FONT};color:${P["--on-volt"]};text-decoration:none;border-radius:${R["--r-pill"]};">${escape(d.button.label)}</a></td></tr></table>`;
  const more = d.more
    ? `<p class="t3" style="margin:20px 0 0;font:400 14px/1.5 ${FONT};color:${P["--text-tertiary"]};">${escape(d.more.text)} <a class="t1" href="${escape(url(d.more.path))}" style="color:${P["--text"]};text-decoration:underline;">${escape(d.more.label)}</a>.</p>`
    : "";
  const foot = footer.link
    ? `${escape(footer.text)} <a class="t3" href="${escape(settings)}" style="color:${P["--text-tertiary"]};text-decoration:underline;">${escape(footer.link)}</a>.`
    : escape(footer.text);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escape(d.subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .bg { background: ${N["--bg"]} !important; }
    .card { background: ${N["--surface"]} !important; border-color: ${N["--line"]} !important; }
    .line { border-color: ${N["--line"]} !important; }
    .t1 { color: ${N["--text"]} !important; }
    .t2 { color: ${N["--text-secondary"]} !important; }
    .t3 { color: ${N["--text-tertiary"]} !important; }
    .note { background: ${N["--surface"]} !important; color: ${N["--warning"]} !important; }
  }
  @media (max-width: 480px) { .card { padding: 24px 20px !important; } }
</style>
</head>
<body class="bg" style="margin:0;padding:0;background:${P["--bg"]};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(d.preview)}</div>
<table role="presentation" class="bg" width="100%" cellpadding="0" cellspacing="0" style="background:${P["--bg"]};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
<tr><td style="padding:0 4px 18px;"><a class="t1" href="${escape(url("/"))}" style="font:800 26px/1 ${FONT};letter-spacing:-0.05em;color:${P["--text"]};text-decoration:none;">bamio</a></td></tr>
<tr><td class="card" style="background:${P["--surface"]};border:1px solid ${P["--line"]};border-radius:${R["--r-md"]};padding:32px 28px;">
<h1 class="t1" style="margin:0 0 14px;font:700 24px/1.2 ${FONT};letter-spacing:-0.02em;color:${P["--text"]};">${escape(d.heading)}</h1>
${body}
${button}
${more}
</td></tr>
<tr><td class="t3" style="padding:18px 4px 0;font:400 13px/1.5 ${FONT};color:${P["--text-tertiary"]};">${foot}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    d.heading,
    "",
    ...d.blocks.flatMap((b) => ("p" in b ? [b.p, ""] : "note" in b ? [`Note: ${b.note}`, ""] : [...b.list.map((i) => `- ${i.title} (${i.meta})`), ""])),
    `${d.button.label}: ${url(d.button.path)}`,
    ...(d.more ? ["", `${d.more.text} ${d.more.label}: ${url(d.more.path)}`] : []),
    "",
    "--",
    footer.link ? `${footer.text} ${footer.link}: ${settings}` : footer.text,
  ].join("\n");

  return { subject: d.subject, html, text };
}
