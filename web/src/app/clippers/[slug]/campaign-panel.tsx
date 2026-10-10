"use client";

import { useUser } from "@clerk/nextjs";
import { ArrowUpRight, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { PLATFORM_ICONS } from "@/components/campaigns/parts";
import { useToast } from "@/components/toast";
import { formatPrice } from "@/lib/billing/plans";
import { api } from "@/lib/clips/api";
import { clipLink, CLIP_PLATFORMS, type ClipPlatform } from "@/lib/campaigns/links";
import { compactNumber } from "@/lib/campaigns/money";
import { CAMPAIGN_LIMITS, clipperInputSchema, type CampaignStatus, type MyCampaign, type MyClip } from "@/lib/campaigns/schema";
import styles from "../clippers.module.css";

type Props = { slug: string; brand: string; status: CampaignStatus; platforms: ClipPlatform[] };

const names = (platforms: ClipPlatform[]) => platforms.map((p) => CLIP_PLATFORMS[p].name).join(", ");

/**
 * A visitor's place in a campaign, decided in the browser: signed out, an invitation to sign
 * in; signed in, the form to join; once joined, where clips are sent, how each is doing and
 * what has been earned and paid.
 */
export function CampaignPanel(props: Props) {
  const { user, isLoaded, isSignedIn } = useUser();
  const [mine, setMine] = useState<MyCampaign | null>(null);
  const [failed, setFailed] = useState(false);
  const open = props.status === "live";

  useEffect(() => {
    if (!isSignedIn) return;
    const controller = new AbortController();
    api.campaigns.me(props.slug, controller.signal).then(setMine, (err: unknown) => {
      if (!(err instanceof Error && err.name === "AbortError")) setFailed(true);
    });
    return () => controller.abort();
  }, [isSignedIn, props.slug]);

  // A clip just sent is counted within moments: look again a few times, so its views show without a reload.
  const counting = mine?.clips.some((c) => c.status !== "rejected" && c.views === null && !c.byHand) ?? false;
  const [looks, setLooks] = useState(0);
  useEffect(() => {
    if (!counting || looks >= 6) return;
    const timer = setTimeout(() => {
      setLooks((n) => n + 1);
      api.campaigns.me(props.slug).then(setMine, () => undefined);
    }, 8000);
    return () => clearTimeout(timer);
  }, [counting, looks, mine, props.slug]);

  if (!isLoaded) return <div className={`skeleton ${styles.panelWait}`} aria-busy="true" />;

  if (!isSignedIn || !user) {
    return (
      <div className={styles.panel}>
        <h2 className="t-heading-md">{open ? "Join this campaign" : props.status === "ended" ? "This campaign has ended" : "Not taking clips right now"}</h2>
        {open ? (
          <>
            <p className={styles.panelText}>Sign in, add your channel and send the links to the clips you post. Joining is free.</p>
            <Link className="btn btn-primary" href={`/sign-in?redirect_url=${encodeURIComponent(`/clippers/${props.slug}`)}`}>
              Sign in to join
            </Link>
          </>
        ) : (
          <p className={styles.panelText}>{props.status === "ended" ? "Its budget is used or its last day has passed. Clippers who took part can sign in to see their clips." : "It’s paused. Check back soon."}</p>
        )}
      </div>
    );
  }

  if (failed) {
    return (
      <div className="notice is-error" role="alert">
        <WarningCircle size={20} weight="fill" aria-hidden />
        <p>
          <strong>Couldn’t load your place in this campaign</strong>
          Check your connection and reload.
        </p>
      </div>
    );
  }
  if (!mine) return <div className={`skeleton ${styles.panelWait}`} aria-busy="true" />;

  if (mine.clipper?.blocked) {
    return (
      <div className="notice is-warning" role="status">
        <WarningCircle size={20} weight="fill" aria-hidden />
        <p>
          <strong>Your account can’t take part in campaigns</strong>
          Bamio’s team turned this off for your account.
        </p>
      </div>
    );
  }

  if (!mine.joined) {
    if (!open) {
      return (
        <div className={styles.panel}>
          <h2 className="t-heading-md">{props.status === "ended" ? "This campaign has ended" : "Not taking clippers right now"}</h2>
          <p className={styles.panelText}>{props.status === "ended" ? "Its budget is used or its last day has passed." : "It’s paused. Check back soon."}</p>
        </div>
      );
    }
    const fallbackName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "";
    return <JoinForm {...props} start={{ name: mine.clipper?.name ?? fallbackName, link: mine.clipper?.link ?? "", payout: mine.clipper?.payout ?? "" }} onJoined={setMine} />;
  }

  return (
    <Joined
      {...props}
      mine={mine}
      onChange={(next) => {
        setLooks(0);
        setMine(next);
      }}
    />
  );
}

type Details = { name: string; link: string; payout: string };

function JoinForm({ slug, brand, platforms, start, onJoined }: Props & { start: Details; onJoined: (mine: MyCampaign) => void }) {
  const toast = useToast();
  const router = useRouter();
  const id = useId();
  const [values, setValues] = useState<Details>(start);
  const [errors, setErrors] = useState<Partial<Record<keyof Details, string>>>({});
  const [busy, setBusy] = useState(false);
  const set = (key: keyof Details, value: string) => setValues((v) => ({ ...v, [key]: value }));

  async function join(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    const parsed = clipperInputSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setBusy(true);
    try {
      onJoined(await api.campaigns.join(slug, parsed.data));
      toast({ tone: "success", title: "You’re in", body: `Post your clips on ${names(platforms)}, then send their links here.` });
      router.refresh();
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t join", body: err instanceof Error ? err.message : "Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={(e) => void join(e)} noValidate>
      <h2 className="t-heading-md">Join this campaign</h2>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-name`}>
          Your name as a clipper
        </label>
        <input
          id={`${id}-name`}
          className="input"
          type="text"
          autoComplete="nickname"
          maxLength={CAMPAIGN_LIMITS.name}
          value={values.name}
          disabled={busy}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={`${id}-name-help`}
          onChange={(e) => set("name", e.target.value)}
        />
        <p id={`${id}-name-help`} className={errors.name ? "field-error" : "field-help"} role={errors.name ? "alert" : undefined}>
          {errors.name ?? "Shown on leaderboards, with your profile picture."}
        </p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-link`}>
          Your channel
        </label>
        <input
          id={`${id}-link`}
          className="input"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="tiktok.com/@yourname"
          value={values.link}
          disabled={busy}
          aria-invalid={errors.link ? true : undefined}
          aria-describedby={`${id}-link-help`}
          onChange={(e) => set("link", e.target.value)}
        />
        <p id={`${id}-link-help`} className={errors.link ? "field-error" : "field-help"} role={errors.link ? "alert" : undefined}>
          {errors.link ?? "Where you post your clips. Shown beside your name."}
        </p>
      </div>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-payout`}>
          How to pay you <span className="t-tertiary">(optional for now)</span>
        </label>
        <input
          id={`${id}-payout`}
          className="input"
          type="text"
          autoComplete="off"
          maxLength={CAMPAIGN_LIMITS.payout}
          placeholder="PayPal: you@example.com"
          value={values.payout}
          disabled={busy}
          aria-invalid={errors.payout ? true : undefined}
          aria-describedby={`${id}-payout-help`}
          onChange={(e) => set("payout", e.target.value)}
        />
        <p id={`${id}-payout-help`} className={errors.payout ? "field-error" : "field-help"} role={errors.payout ? "alert" : undefined}>
          {errors.payout ?? "Bamio pays you with this. Only Bamio’s team sees it. Never a card number or a password."}
        </p>
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
        {busy ? "Joining…" : "Join the campaign"}
      </button>
      <p className={styles.panelSmall}>By joining you agree to the campaign’s rules. Bamio counts the views and pays you what your approved clips earn, from what {brand} pays for the campaign.</p>
    </form>
  );
}

function Joined({ slug, status, platforms, mine, onChange }: Props & { mine: MyCampaign; onChange: (mine: MyCampaign) => void }) {
  const toast = useToast();
  const router = useRouter();
  const id = useId();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = status === "live";

  /** Run a change, show the clipper's new place, and reload the page's numbers (budget, leaderboard). */
  async function change(work: () => Promise<MyCampaign>, done: { title: string; body?: string }, failedTitle: string) {
    setBusy(true);
    try {
      onChange(await work());
      toast({ tone: "success", ...done });
      router.refresh();
      return true;
    } catch (err) {
      toast({ tone: "error", title: failedTitle, body: err instanceof Error ? err.message : "Check your connection and try again." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const link = clipLink(url);
    if (!link) return setError(`Paste the link to your clip’s own page on ${names(platforms)}.`);
    if (!platforms.includes(link.platform)) return setError(`This campaign takes clips posted on ${names(platforms)}.`);
    setError(null);
    if (await change(() => api.campaigns.sendClip(slug, url.trim()), { title: "Clip sent", body: "It counts once Bamio’s team has looked at it." }, "Couldn’t send that clip")) setUrl("");
  }

  return (
    <div className={styles.panel}>
      <h2 className="t-heading-md">Your clips</h2>
      <dl className={styles.totals}>
        <div>
          <dt>Earned</dt>
          <dd>{formatPrice(mine.earnedCents)}</dd>
        </div>
        <div>
          <dt>Paid</dt>
          <dd>{formatPrice(mine.paidCents)}</dd>
        </div>
        <div>
          <dt>To come</dt>
          <dd>{formatPrice(mine.owedCents)}</dd>
        </div>
      </dl>

      {mine.owedCents > 0 && !mine.clipper?.payout ? (
        <p className="notice" role="status">
          <span>
            You’re owed money, and there’s no way to pay you yet.{" "}
            <Link className={styles.inlineLink} href="/profile/clipper">
              Add how to pay you
            </Link>
          </span>
        </p>
      ) : null}

      {open ? (
        <form className="field" onSubmit={(e) => void send(e)} noValidate>
          <label className="field-label" htmlFor={`${id}-url`}>
            Send a clip you posted
          </label>
          <div className={styles.sendRow}>
            <input
              id={`${id}-url`}
              className="input"
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder="The link to your clip"
              value={url}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              aria-describedby={`${id}-url-help`}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !url.trim()} aria-busy={busy}>
              Send
            </button>
          </div>
          <p id={`${id}-url-help`} className={error ? "field-error" : "field-help"} role={error ? "alert" : undefined}>
            {error ?? `A clip on your own channel, on ${names(platforms)}.`}
          </p>
        </form>
      ) : (
        <p className={styles.panelText}>{status === "ended" ? "This campaign has ended, so it takes no more clips. Your numbers stay here." : "This campaign is paused: it isn’t taking clips right now."}</p>
      )}

      {mine.clips.length === 0 ? (
        <p className={styles.panelText}>Nothing sent yet. Post a clip, copy its link and paste it above.</p>
      ) : (
        <ul className={styles.clips} aria-label="Clips you sent">
          {mine.clips.map((clip) => (
            <ClipRow key={clip.id} clip={clip} busy={busy} onTakeBack={() => void change(() => api.campaigns.withdrawClip(slug, clip.id), { title: "Clip taken back" }, "Couldn’t take that clip back")} />
          ))}
        </ul>
      )}

      <p className={styles.panelSmall}>
        Clipping as {mine.clipper?.name ?? "yourself"}.{" "}
        <Link className={styles.inlineLink} href="/profile/clipper">
          Change your name, channel or how to pay you
        </Link>
      </p>
    </div>
  );
}

const CLIP_BADGE: Record<MyClip["status"], [tone: string, label: string]> = {
  pending: ["is-info", "Waiting for a look"],
  approved: ["is-success", "Counting"],
  rejected: ["is-error", "Not accepted"],
};

function ClipRow({ clip, busy, onTakeBack }: { clip: MyClip; busy: boolean; onTakeBack: () => void }) {
  const PlatformIcon = PLATFORM_ICONS[clip.platform];
  const [tone, label] = CLIP_BADGE[clip.status];
  // The post's id, enough to tell clips apart at a glance.
  const short = clip.url.replace(/^https:\/\/(www\.)?/, "").replace(/\/$/, "");
  return (
    <li className={styles.clip}>
      <a className={styles.clipLink} href={clip.url} target="_blank" rel="noopener noreferrer">
        <PlatformIcon size={16} weight="fill" aria-hidden />
        <span className={styles.handle}>{short}</span>
        <ArrowUpRight size={14} aria-hidden />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
      <div className={styles.clipState}>
        <span className={`badge ${tone}`}>{label}</span>
        <span className={styles.clipNumbers}>
          {clip.views !== null ? `${compactNumber(clip.views)} views` : clip.byHand ? "Views added by the team" : "Counting views…"}
          {clip.status === "approved" ? ` · ${formatPrice(clip.earnedCents)}` : ""}
        </span>
        {clip.status === "pending" ? (
          <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={onTakeBack}>
            Take back
          </button>
        ) : null}
      </div>
      {clip.note ? <p className={styles.clipNote}>{clip.note}</p> : null}
    </li>
  );
}
