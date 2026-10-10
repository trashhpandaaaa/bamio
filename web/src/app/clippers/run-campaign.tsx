"use client";

import { useAuth } from "@clerk/nextjs";
import { Microphone, Storefront, VideoCamera } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { StatusBadge } from "@/components/campaigns/parts";
import { useToast } from "@/components/toast";
import { formatPrice } from "@/lib/billing/plans";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/contact";
import { COMPANY } from "@/lib/legal";
import { api } from "@/lib/clips/api";
import { CLIP_PLATFORM_IDS, CLIP_PLATFORMS, type ClipPlatform } from "@/lib/campaigns/links";
import { CAMPAIGN_LIMITS, campaignRequestSchema, parseDollars, REQUEST_KIND_IDS, REQUEST_KINDS, type MyCampaignRequest, type RequestKind } from "@/lib/campaigns/schema";
import styles from "./clippers.module.css";

const AUDIENCES = [
  { icon: Microphone, title: "Podcasters", text: "Every episode has a few minutes worth a short. Clippers find them and post them where new listeners are." },
  { icon: VideoCamera, title: "Streamers", text: "Hours of stream, cut down to the plays and reactions people share, by the people who watch you anyway." },
  { icon: Storefront, title: "Businesses", text: "Launches, demos and talks in front of people who would never sit through the long version." },
];

const STEPS = [
  { title: "Tell us about it", text: "Your content, what makes a good clip, what you pay per 1,000 views and your budget." },
  { title: "We check it and open it", text: "Bamio’s team looks at every campaign before clippers see it, and writes to you when it’s live." },
  { title: "Clips come in, you pay for views", text: "We look at each clip and count its views. You pay for what the clips earned, up to your budget." },
];

/**
 * "Run a campaign", on the campaigns page: for podcasters, streamers and businesses who want
 * clips of their content. Signed in, they fill in a short form; it goes to Bamio's team, who
 * make the campaign from it (the admin panel's Campaigns), and their requests show here with
 * where each stands. `startOpen`: arrived to fill it in (back from signing in: ?run=1).
 *
 * Who is paid, and how, isn't explained here: that's on the terms and the privacy page (the
 * user's choice, 2026-10-10). The form asks for the rate and the budget, nothing about payment.
 */
export function RunCampaign({ startOpen }: { startOpen: boolean }) {
  const { isLoaded, isSignedIn } = useAuth();
  const toast = useToast();
  const section = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(startOpen);
  const [requests, setRequests] = useState<MyCampaignRequest[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;
    const controller = new AbortController();
    // If this fails the section still works: the list is only what they sent before.
    api.campaignRequests.mine(controller.signal).then(setRequests, () => undefined);
    return () => controller.abort();
  }, [isSignedIn]);

  useEffect(() => {
    if (startOpen) section.current?.scrollIntoView({ block: "start" });
  }, [startOpen]);

  async function takeBack(id: number) {
    setBusy(true);
    try {
      setRequests(await api.campaignRequests.withdraw(id));
      toast({ tone: "success", title: "Request taken back" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t take it back", body: err instanceof Error ? err.message : "Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="run" ref={section} className={`container ${styles.section}`} aria-labelledby="run-title">
      <div className={styles.runHead}>
        <p className={styles.brand}>For podcasters, streamers and businesses</p>
        <h2 id="run-title" className="t-heading-xl">
          Run a campaign
        </h2>
        <p className={styles.lede}>Put up a budget, say what you pay per 1,000 views, and clippers turn your content into shorts on their own channels. You pay for views, not for posts.</p>
      </div>

      <ul className={styles.audiences}>
        {AUDIENCES.map((a) => (
          <li key={a.title} className={styles.audience}>
            <a.icon size={24} aria-hidden />
            <h3 className="t-heading-sm">{a.title}</h3>
            <p>{a.text}</p>
          </li>
        ))}
      </ul>

      <ol className={styles.steps}>
        {STEPS.map((step, i) => (
          <li key={step.title} className={styles.step}>
            <span className={styles.number} aria-hidden="true">
              {i + 1}
            </span>
            <h3 className="t-heading-sm">{step.title}</h3>
            <p>{step.text}</p>
          </li>
        ))}
      </ol>

      {isSignedIn && requests && requests.length > 0 ? (
        <div className={styles.runBlock}>
          <h3 className="t-heading-sm">Campaigns you asked for</h3>
          <ul className={styles.yours}>
            {requests.map((r) => (
              <RequestRow key={r.id} request={r} busy={busy} onTakeBack={() => void takeBack(r.id)} />
            ))}
          </ul>
        </div>
      ) : null}

      {open && isSignedIn ? (
        <RequestForm
          onCancel={() => setOpen(false)}
          onSent={(list) => {
            setRequests(list);
            setOpen(false);
          }}
        />
      ) : (
        <div className={styles.runActions}>
          {isLoaded && isSignedIn ? (
            <button className="btn btn-primary btn-lg" type="button" onClick={() => setOpen(true)}>
              Set up a campaign
            </button>
          ) : (
            <Link className="btn btn-primary btn-lg" href={`/sign-in?redirect_url=${encodeURIComponent("/clippers?run=1")}`}>
              Sign in to set up a campaign
            </Link>
          )}
          <p className={styles.small}>
            Bamio’s team looks at every campaign before it opens. Questions first? Write to{" "}
            <a className={styles.mail} href={CONTACT_MAILTO}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </div>
      )}
    </section>
  );
}

function RequestRow({ request: r, busy, onTakeBack }: { request: MyCampaignRequest; busy: boolean; onTakeBack: () => void }) {
  const live = r.status === "accepted" && r.campaign && r.campaign.status !== "draft" ? r.campaign : null;
  return (
    <li className={styles.requestRow}>
      <span className={styles.yourName}>
        <b>{r.name}</b>
        <span>
          {REQUEST_KINDS[r.kind]} · {formatPrice(r.rateCents)} per 1,000 views · {formatPrice(r.budgetCents)} budget
        </span>
        {r.status === "declined" && r.note ? <span className={styles.requestNote}>{r.note}</span> : null}
      </span>
      {live ? (
        <StatusBadge status={live.status} />
      ) : (
        <span className={`badge ${r.status === "pending" ? "is-info" : r.status === "declined" ? "is-error" : "is-success"}`}>
          {r.status === "pending" ? "Waiting for a look" : r.status === "declined" ? "Not opened" : "Being set up"}
        </span>
      )}
      {live ? (
        <Link className="btn btn-secondary btn-sm" href={`/clippers/${live.slug}`}>
          See it
        </Link>
      ) : r.status === "pending" ? (
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={onTakeBack}>
          Take back
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
    </li>
  );
}

type Values = { kind: RequestKind; name: string; sourceUrl: string; brief: string; platforms: ClipPlatform[]; rate: string; budget: string; contact: string };
const BLANK: Values = { kind: "podcaster", name: "", sourceUrl: "", brief: "", platforms: ["tiktok", "youtube", "instagram"], rate: "", budget: "", contact: "" };

function RequestForm({ onSent, onCancel }: { onSent: (requests: MyCampaignRequest[]) => void; onCancel: () => void }) {
  const toast = useToast();
  const id = useId();
  const [values, setValues] = useState<Values>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function send(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    const rateCents = parseDollars(values.rate);
    const budgetCents = parseDollars(values.budget);
    if (rateCents === null) found.rateCents = "An amount in dollars, like 2 or 1.50.";
    if (budgetCents === null) found.budgetCents = "An amount in dollars, like 500.";
    const parsed = campaignRequestSchema.safeParse({ ...values, rateCents: rateCents ?? 1, budgetCents: budgetCents ?? 1 });
    if (!parsed.success) for (const issue of parsed.error.issues) found[String(issue.path[0])] ??= issue.message;
    setErrors(found);
    if (!parsed.success || Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      onSent(await api.campaignRequests.send(parsed.data));
      toast({ tone: "success", title: "Sent to Bamio’s team", body: "We’ll look at it and email you when your campaign is live." });
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t send it", body: err instanceof Error ? err.message : "Check your connection and try again." });
      setBusy(false);
    }
  }

  const help = (key: string, name: string, text: string) => (
    <p id={`${id}-${key}-help`} className={errors[name] ? "field-error" : "field-help"} role={errors[name] ? "alert" : undefined}>
      {errors[name] ?? text}
    </p>
  );

  return (
    <form className={styles.requestForm} onSubmit={(e) => void send(e)} noValidate aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="t-heading-md">
        Your campaign
      </h3>

      <div className="field">
        <span className="field-label" id={`${id}-kind`}>
          You are a
        </span>
        <div className="seg" role="group" aria-labelledby={`${id}-kind`}>
          {REQUEST_KIND_IDS.map((k) => (
            <button key={k} type="button" aria-pressed={values.kind === k} disabled={busy} onClick={() => set("kind", k)}>
              {REQUEST_KINDS[k]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.pair}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-name`}>
            {values.kind === "business" ? "Your business" : values.kind === "streamer" ? "Your channel’s name" : "Your show’s name"}
          </label>
          <input
            id={`${id}-name`}
            className="input"
            type="text"
            autoComplete="organization"
            maxLength={CAMPAIGN_LIMITS.brand}
            value={values.name}
            disabled={busy}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={`${id}-name-help`}
            onChange={(e) => set("name", e.target.value)}
          />
          {help("name", "name", "Clippers see this on the campaign.")}
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-source`}>
            Your content
          </label>
          <input
            id={`${id}-source`}
            className="input"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="youtube.com/@yourshow"
            value={values.sourceUrl}
            disabled={busy}
            aria-invalid={errors.sourceUrl ? true : undefined}
            aria-describedby={`${id}-source-help`}
            onChange={(e) => set("sourceUrl", e.target.value)}
          />
          {help("source", "sourceUrl", "A link to the channel, show or videos to clip.")}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-brief`}>
          What should clippers clip?
        </label>
        <textarea
          id={`${id}-brief`}
          className="textarea"
          rows={4}
          maxLength={CAMPAIGN_LIMITS.brief}
          placeholder="The funniest or most surprising minute of each episode. Keep my intro out."
          value={values.brief}
          disabled={busy}
          aria-invalid={errors.brief ? true : undefined}
          aria-describedby={`${id}-brief-help`}
          onChange={(e) => set("brief", e.target.value)}
        />
        {help("brief", "brief", "Which content, what makes a good clip, anything to leave out.")}
      </div>

      <div className="field">
        <span className="field-label" id={`${id}-platforms`}>
          Where clips may be posted
        </span>
        <div className={styles.chips} role="group" aria-labelledby={`${id}-platforms`}>
          {CLIP_PLATFORM_IDS.map((p) => (
            <button
              key={p}
              type="button"
              className="chip"
              aria-pressed={values.platforms.includes(p)}
              disabled={busy}
              onClick={() => set("platforms", values.platforms.includes(p) ? values.platforms.filter((x) => x !== p) : [...values.platforms, p])}
            >
              {CLIP_PLATFORMS[p].name}
            </button>
          ))}
        </div>
        {errors.platforms ? (
          <p className="field-error" role="alert">
            {errors.platforms}
          </p>
        ) : null}
      </div>

      <div className={styles.pair}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-rate`}>
            You pay per 1,000 views ($)
          </label>
          <input
            id={`${id}-rate`}
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="2"
            value={values.rate}
            disabled={busy}
            aria-invalid={errors.rateCents ? true : undefined}
            aria-describedby={`${id}-rate-help`}
            onChange={(e) => set("rate", e.target.value)}
          />
          {help("rate", "rateCents", "What a clip earns for each 1,000 views.")}
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-budget`}>
            Your budget ($)
          </label>
          <input
            id={`${id}-budget`}
            className="input"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="500"
            value={values.budget}
            disabled={busy}
            aria-invalid={errors.budgetCents ? true : undefined}
            aria-describedby={`${id}-budget-help`}
            onChange={(e) => set("budget", e.target.value)}
          />
          {help("budget", "budgetCents", "The most you’ll pay in all. The campaign ends when it’s used.")}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-contact`}>
          Another way to reach you <span className="t-tertiary">(optional)</span>
        </label>
        <input
          id={`${id}-contact`}
          className="input"
          type="text"
          autoComplete="off"
          maxLength={CAMPAIGN_LIMITS.note}
          placeholder="Discord, WhatsApp, a work email"
          value={values.contact}
          disabled={busy}
          aria-describedby={`${id}-contact-help`}
          onChange={(e) => set("contact", e.target.value)}
        />
        {help("contact", "contact", "We write to your account’s email unless you’d rather something else. Only Bamio’s team sees this.")}
      </div>

      <div className={styles.formActions}>
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? "Sending…" : "Send it to Bamio’s team"}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onCancel}>
          Not now
        </button>
      </div>
      <p className={styles.panelSmall}>
        By sending this you agree to pay what clippers’ clips earn under these terms, up to your budget
        {/* The terms of service say who is paid and how; they're linked once the company's details are in (legal.ts). */}
        {COMPANY.ready ? (
          <>
            , and to Bamio’s{" "}
            <Link className={styles.inlineLink} href="/terms">
              terms of service
            </Link>
          </>
        ) : null}
        . Something to ask first? Write to{" "}
        <a className={styles.mail} href={CONTACT_MAILTO}>
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </form>
  );
}
