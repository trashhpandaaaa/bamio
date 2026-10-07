"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { formatPrice } from "@/lib/billing/plans";
import { api } from "@/lib/clips/api";
import { CLIP_PLATFORM_IDS, CLIP_PLATFORMS, type ClipPlatform } from "@/lib/campaigns/links";
import { CAMPAIGN_LIMITS, campaignInputSchema, parseDollars, type Campaign, type CampaignStatus, type ClipStatus } from "@/lib/campaigns/schema";
import { useAction } from "../admin-controls";
import styles from "../admin.module.css";

/* The admin panel's changes to campaigns: the form, opening and ending, looking at clips, recording payments. */

const dollars = (cents: number | null) => (cents === null ? "" : cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2));
/** A date field's value ("2026-10-31") as the end of that day, UTC; back again for the field. */
const dayEnd = (value: string) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T23:59:59Z`) : null);
const dayValue = (ms: number | null) => (ms === null ? "" : new Date(ms).toISOString().slice(0, 10));

type FormValues = {
  title: string;
  brand: string;
  summary: string;
  brief: string;
  rules: string;
  sourceUrl: string;
  platforms: ClipPlatform[];
  rate: string;
  budget: string;
  minViews: string;
  maxClip: string;
  payout: string;
  ends: string;
};

type TextKey = Exclude<keyof FormValues, "platforms">;

const BLANK: FormValues = { title: "", brand: "", summary: "", brief: "", rules: "", sourceUrl: "", platforms: ["tiktok", "youtube"], rate: "", budget: "", minViews: "0", maxClip: "", payout: "", ends: "" };

/** What the form takes from a request to run a campaign (the "Run a campaign" form on /clippers). */
export type RequestStart = { id: number; name: string; sourceUrl: string; brief: string; platforms: ClipPlatform[]; rateCents: number; budgetCents: number; payout: string };

/** Make a campaign (it starts as a draft) or change one. `request`: start from what someone asked for; making it answers their request. */
export function CampaignForm({ campaign, request }: { campaign?: Campaign; request?: RequestStart }) {
  const router = useRouter();
  const toast = useToast();
  const id = useId();
  const [values, setValues] = useState<FormValues>(
    campaign
      ? {
          title: campaign.title,
          brand: campaign.brand,
          summary: campaign.summary,
          brief: campaign.brief,
          rules: campaign.rules.join("\n"),
          sourceUrl: campaign.sourceUrl ?? "",
          platforms: campaign.platforms,
          rate: dollars(campaign.rateCents),
          budget: dollars(campaign.budgetCents),
          minViews: String(campaign.minViews),
          maxClip: dollars(campaign.maxClipCents),
          payout: campaign.payout,
          ends: dayValue(campaign.endsAt),
        }
      : request
        ? { ...BLANK, title: `Clip ${request.name}`.slice(0, CAMPAIGN_LIMITS.title), brand: request.name, brief: request.brief, sourceUrl: request.sourceUrl, platforms: request.platforms, rate: dollars(request.rateCents), budget: dollars(request.budgetCents), payout: request.payout }
        : BLANK,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function save(e: FormEvent) {
    e.preventDefault();
    const found: Record<string, string> = {};
    const rateCents = parseDollars(values.rate);
    const budgetCents = parseDollars(values.budget);
    const maxClipCents = values.maxClip.trim() ? parseDollars(values.maxClip) : null;
    const minViews = /^\d{1,10}$/.test(values.minViews.trim()) ? Number(values.minViews.trim()) : null;
    const endsAt = values.ends ? dayEnd(values.ends) : null;
    if (rateCents === null) found.rateCents = "An amount in dollars, like 2 or 1.50.";
    if (budgetCents === null) found.budgetCents = "An amount in dollars, like 1000.";
    if (values.maxClip.trim() && maxClipCents === null) found.maxClipCents = "An amount in dollars, or leave it empty.";
    if (minViews === null) found.minViews = "A whole number of views (0 for none).";
    if (values.ends && endsAt === null) found.endsAt = "A date, or leave it empty.";
    const parsed = campaignInputSchema.safeParse({
      title: values.title,
      brand: values.brand,
      summary: values.summary,
      brief: values.brief,
      rules: values.rules,
      sourceUrl: values.sourceUrl,
      platforms: values.platforms,
      rateCents: rateCents ?? 1,
      budgetCents: budgetCents ?? 1,
      minViews: minViews ?? 0,
      maxClipCents,
      payout: values.payout,
      endsAt,
    });
    if (!parsed.success) for (const issue of parsed.error.issues) found[String(issue.path[0])] ??= issue.message;
    setErrors(found);
    if (!parsed.success || Object.keys(found).length > 0) {
      toast({ tone: "error", title: "Some fields need another look" });
      return;
    }
    setBusy(true);
    try {
      if (campaign) {
        await api.admin.updateCampaign(campaign.id, parsed.data);
        toast({ tone: "success", title: "Campaign saved" });
        router.push(`/admin/campaigns/${campaign.id}`);
      } else {
        const made = await api.admin.createCampaign(parsed.data, request?.id);
        toast({ tone: "success", title: "Draft made", body: request ? `Look it over, then open it: ${request.name} is emailed when it goes live.` : "Look it over, then open it." });
        router.push(`/admin/campaigns/${made.id}`);
      }
      router.refresh();
    } catch (err) {
      toast({ tone: "error", title: "That didn’t work", body: err instanceof Error ? err.message : "Try again." });
      setBusy(false);
    }
  }

  const field = (key: TextKey, name: string, label: string, help: string, props: { type?: string; placeholder?: string; maxLength?: number; inputMode?: "decimal" | "numeric" | "url" } = {}) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        className="input"
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        autoComplete="off"
        value={values[key]}
        disabled={busy}
        aria-invalid={errors[name] ? true : undefined}
        aria-describedby={`${id}-${key}-help`}
        onChange={(e) => set(key, e.target.value)}
      />
      <p id={`${id}-${key}-help`} className={errors[name] ? "field-error" : "field-help"} role={errors[name] ? "alert" : undefined}>
        {errors[name] ?? help}
      </p>
    </div>
  );
  const area = (key: "brief" | "rules" | "payout", label: string, help: string, max: number, rows: number) => (
    <div className="field">
      <label className="field-label" htmlFor={`${id}-${key}`}>
        {label}
      </label>
      <textarea
        id={`${id}-${key}`}
        className="textarea"
        rows={rows}
        maxLength={max}
        value={values[key]}
        disabled={busy}
        aria-invalid={errors[key] ? true : undefined}
        aria-describedby={`${id}-${key}-help`}
        onChange={(e) => set(key, e.target.value)}
      />
      <p id={`${id}-${key}-help`} className={errors[key] ? "field-error" : "field-help"} role={errors[key] ? "alert" : undefined}>
        {errors[key] ?? help}
      </p>
    </div>
  );

  return (
    <form className={styles.form} onSubmit={(e) => void save(e)} noValidate>
      <section className={styles.panel} aria-labelledby={`${id}-what`}>
        <h2 id={`${id}-what`} className="t-heading-sm">
          What it is
        </h2>
        {field("title", "title", "Title", campaign ? "Its address stays the same when the title changes." : "Its address is made from this, and never changes.", { maxLength: CAMPAIGN_LIMITS.title, placeholder: "Clip the summer tournament" })}
        {field("brand", "brand", "Whose campaign", "The creator or brand whose content it is, and who pays.", { maxLength: CAMPAIGN_LIMITS.brand })}
        {field("summary", "summary", "One line", "Shown on the campaign’s card.", { maxLength: CAMPAIGN_LIMITS.summary })}
        {area("brief", "What to clip", "Which content, what makes a good clip, what to leave out.", CAMPAIGN_LIMITS.brief, 5)}
        {area("rules", "Rules", "One per line.", CAMPAIGN_LIMITS.rules, 4)}
        {field("sourceUrl", "sourceUrl", "The content", "A link clippers start from (a channel, a video, a stream). Optional.", { type: "url", inputMode: "url", placeholder: "https://" })}
        <fieldset className="field">
          <legend className="field-label">Where clips may be posted</legend>
          <div className={styles.inline}>
            {CLIP_PLATFORM_IDS.map((p) => (
              <label key={p} className="choice">
                <input
                  className="check"
                  type="checkbox"
                  checked={values.platforms.includes(p)}
                  disabled={busy}
                  onChange={(e) => set("platforms", e.target.checked ? [...values.platforms, p] : values.platforms.filter((x) => x !== p))}
                />
                {CLIP_PLATFORMS[p].name}
              </label>
            ))}
          </div>
          <p className={errors.platforms ? "field-error" : "field-help"} role={errors.platforms ? "alert" : undefined}>
            {errors.platforms ?? "Bamio counts views on TikTok and YouTube itself. On Instagram and X someone types them in."}
          </p>
        </fieldset>
      </section>

      <section className={styles.panel} aria-labelledby={`${id}-pay`}>
        <h2 id={`${id}-pay`} className="t-heading-sm">
          What it pays
        </h2>
        <div className={styles.pair}>
          {field("rate", "rateCents", "Per 1,000 views ($)", "What a clip earns for each 1,000 views.", { inputMode: "decimal", placeholder: "2" })}
          {field("budget", "budgetCents", "Budget ($)", "The campaign ends when this is used.", { inputMode: "decimal", placeholder: "1000" })}
        </div>
        <div className={styles.pair}>
          {field("minViews", "minViews", "A clip earns from (views)", "Clips under this earn nothing. 0 for no minimum.", { inputMode: "numeric" })}
          {field("maxClip", "maxClipCents", "Most one clip can earn ($)", "Empty for no cap.", { inputMode: "decimal" })}
        </div>
        {area("payout", "How clippers are paid", "Shown on the page: who pays, how and when. Payments happen outside Bamio.", CAMPAIGN_LIMITS.payoutTerms, 3)}
        {field("ends", "endsAt", "Last day", "Optional. The campaign ends at the end of this day (UTC).", { type: "date" })}
      </section>

      <div className={styles.inline}>
        <button className="btn btn-primary" type="submit" disabled={busy} aria-busy={busy}>
          {busy ? "Saving…" : campaign ? "Save campaign" : "Make the draft"}
        </button>
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => router.back()}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Open, pause or end a campaign; delete a draft. */
export function CampaignStatusActions({ id, title, status }: { id: string; title: string; status: CampaignStatus }) {
  const { busy, run } = useAction();
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState<"end" | "delete" | null>(null);
  const to = (next: "live" | "paused" | "ended", done: string) => run(() => api.admin.campaignStatus(id, next), done);
  /** The draft's page is gone afterwards: back to the list, not a reload of this one. */
  async function remove() {
    try {
      await api.admin.deleteCampaign(id);
      toast({ tone: "success", title: "Draft deleted" });
      router.replace("/admin/campaigns");
    } catch (err) {
      toast({ tone: "error", title: "That didn’t work", body: err instanceof Error ? err.message : "Try again." });
    }
  }
  return (
    <div className={styles.inline}>
      {status === "draft" ? (
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => to("live", "The campaign is open")}>
          Go live
        </button>
      ) : null}
      {status === "live" ? (
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={() => to("paused", "The campaign is paused")}>
          Pause
        </button>
      ) : null}
      {status === "paused" || status === "ended" ? (
        <button className="btn btn-primary" type="button" disabled={busy} onClick={() => to("live", "The campaign is open again")}>
          Reopen
        </button>
      ) : null}
      {status === "live" || status === "paused" ? (
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setConfirming("end")}>
          End
        </button>
      ) : null}
      {status === "draft" ? (
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setConfirming("delete")}>
          Delete draft
        </button>
      ) : null}
      <ConfirmDialog
        open={confirming === "end"}
        title={`End “${title}”?`}
        body="It takes no more clippers or clips, and views stop being counted. What clippers earned stays, so they can still be paid."
        confirmLabel="End campaign"
        cancelLabel="Keep it running"
        destructive
        onClose={() => setConfirming(null)}
        onConfirm={() => void to("ended", "The campaign has ended")}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        title={`Delete the draft “${title}”?`}
        body="Nobody has seen it. This can’t be undone."
        confirmLabel="Delete draft"
        destructive
        onClose={() => setConfirming(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

/** A <dialog> with a form in it (ConfirmDialog only asks yes or no). */
function FormDialog({ open, title, submitLabel, busy, onClose, onSubmit, children }: { open: boolean; title: string; submitLabel: string; busy: boolean; onClose: () => void; onSubmit: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <form
        className={styles.dialogForm}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        noValidate
      >
        <h2 className="dialog-title" id={titleId}>
          {title}
        </h2>
        {children}
        <div className="dialog-actions">
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** A clip in a campaign: approve it, reject it with a word why, type its views in, or have Bamio read them again. */
export function ClipActions({ clipId, who, status, platform, views, byHand }: { clipId: number; who: string; status: ClipStatus; platform: ClipPlatform; views: number; byHand: number | null }) {
  const { busy, run } = useAction();
  const id = useId();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [counting, setCounting] = useState(false);
  const [typed, setTyped] = useState(String(views));
  const [typedError, setTypedError] = useState<string | null>(null);
  const counted = CLIP_PLATFORMS[platform].counted;

  function saveViews() {
    const text = typed.trim().replace(/,/g, "");
    if (!/^\d{1,10}$/.test(text) || Number(text) > CAMPAIGN_LIMITS.views) return setTypedError("A whole number of views.");
    setTypedError(null);
    setCounting(false);
    void run(() => api.admin.campaignClip(clipId, { action: "views", views: Number(text) }), "Views set by hand");
  }

  return (
    <div className={styles.rowActions}>
      {status !== "approved" ? (
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => run(() => api.admin.campaignClip(clipId, { action: "approve" }), `${who}’s clip counts now`)}>
          Approve
        </button>
      ) : null}
      {status !== "rejected" ? (
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </button>
      ) : null}
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        disabled={busy}
        onClick={() => {
          setTyped(String(views));
          setCounting(true);
        }}
      >
        Set views
      </button>
      {counted && byHand === null ? (
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => run(() => api.admin.campaignClip(clipId, { action: "recount" }), "Counting again")}>
          Recount
        </button>
      ) : null}

      <FormDialog
        open={rejecting}
        title={`Reject ${who}’s clip?`}
        submitLabel="Reject clip"
        busy={busy}
        onClose={() => setRejecting(false)}
        onSubmit={() => {
          setRejecting(false);
          void run(() => api.admin.campaignClip(clipId, { action: "reject", note: note.trim() }), "Clip rejected");
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor={`${id}-note`}>
            Why (they’ll see this)
          </label>
          <input id={`${id}-note`} className="input" type="text" maxLength={CAMPAIGN_LIMITS.note} placeholder="Not from this campaign’s content" value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="field-help">It stops counting. You can approve it later.</p>
        </div>
      </FormDialog>

      <FormDialog open={counting} title={`Views on ${who}’s clip`} submitLabel="Save views" busy={busy} onClose={() => setCounting(false)} onSubmit={saveViews}>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-views`}>
            Views
          </label>
          <input id={`${id}-views`} className="input" type="text" inputMode="numeric" value={typed} aria-invalid={typedError ? true : undefined} aria-describedby={`${id}-views-help`} onChange={(e) => setTyped(e.target.value)} />
          <p id={`${id}-views-help`} className={typedError ? "field-error" : "field-help"} role={typedError ? "alert" : undefined}>
            {typedError ?? (counted ? "A number typed here wins over the one Bamio reads from the site." : `Open the clip, read its views and type them here: ${CLIP_PLATFORMS[platform].name} doesn’t show them to Bamio.`)}
          </p>
        </div>
        {byHand !== null && counted ? (
          <button
            className="btn btn-secondary btn-sm"
            type="button"
            disabled={busy}
            onClick={() => {
              setCounting(false);
              void run(() => api.admin.campaignClip(clipId, { action: "views", views: null }), "Back to Bamio’s count");
            }}
          >
            Use Bamio’s count again
          </button>
        ) : null}
      </FormDialog>
    </div>
  );
}

/** Write down a payment the campaign's owner made to a clipper, outside Bamio. */
export function PayoutButton({ campaignId, userId, name, owedCents, payout }: { campaignId: string; userId: string; name: string; owedCents: number; payout: string }) {
  const { busy, run } = useAction();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (owedCents <= 0) return null;

  function save() {
    const cents = parseDollars(amount);
    if (cents === null || cents <= 0) return setError("An amount in dollars, like 12.50.");
    if (cents > owedCents) return setError(`They’re owed ${formatPrice(owedCents)}. Record that much or less.`);
    setError(null);
    setOpen(false);
    void run(() => api.admin.payout(campaignId, userId, cents, note.trim()), `${formatPrice(cents)} to ${name} recorded`);
  }

  return (
    <>
      <button
        className="btn btn-secondary btn-sm"
        type="button"
        disabled={busy}
        onClick={() => {
          setAmount(dollars(owedCents));
          setNote("");
          setError(null);
          setOpen(true);
        }}
      >
        Mark paid
      </button>
      <FormDialog open={open} title={`Record a payment to ${name}`} submitLabel="Record payment" busy={busy} onClose={() => setOpen(false)} onSubmit={save}>
        <p className="dialog-body">
          Pay them first, outside Bamio{payout ? ` (${payout})` : ""}. This writes it down and emails them that it was sent.
        </p>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-amount`}>
            Amount paid ($)
          </label>
          <input id={`${id}-amount`} className="input" type="text" inputMode="decimal" value={amount} aria-invalid={error ? true : undefined} aria-describedby={`${id}-amount-help`} onChange={(e) => setAmount(e.target.value)} />
          <p id={`${id}-amount-help`} className={error ? "field-error" : "field-help"} role={error ? "alert" : undefined}>
            {error ?? `They’re owed ${formatPrice(owedCents)}.`}
          </p>
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-pnote`}>
            Note (they’ll see this)
          </label>
          <input id={`${id}-pnote`} className="input" type="text" maxLength={CAMPAIGN_LIMITS.note} placeholder="PayPal, sent today" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </FormDialog>
    </>
  );
}

/** Block a clipper from campaigns (off every leaderboard, earning nothing), or let them back. */
export function BlockButton({ userId, name, blocked }: { userId: string; name: string; blocked: boolean }) {
  const { busy, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  if (blocked) {
    return (
      <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => run(() => api.admin.clipper(userId, "unblock"), `${name} can take part again`)}>
        Unblock
      </button>
    );
  }
  return (
    <>
      <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setConfirming(true)}>
        Block
      </button>
      <ConfirmDialog
        open={confirming}
        title={`Block ${name} from campaigns?`}
        body="In every campaign: they come off the leaderboards, their clips stop counting, and they can’t join or send clips. You can let them back."
        confirmLabel="Block"
        destructive
        onClose={() => setConfirming(false)}
        onConfirm={() => void run(() => api.admin.clipper(userId, "block"), `${name} is blocked`)}
      />
    </>
  );
}

/** Decline a request to run a campaign, with a word why for the person who asked. */
export function DeclineRequestButton({ id: requestId, name }: { id: number; name: string }) {
  const { busy, run } = useAction();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <>
      <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setOpen(true)}>
        Decline
      </button>
      <FormDialog
        open={open}
        title={`Decline ${name}’s campaign?`}
        submitLabel="Decline"
        busy={busy}
        onClose={() => setOpen(false)}
        onSubmit={() => {
          setOpen(false);
          void run(() => api.admin.declineCampaignRequest(requestId, note.trim()), `${name}’s request declined`);
        }}
      >
        <div className="field">
          <label className="field-label" htmlFor={`${id}-why`}>
            Why (they’re emailed this)
          </label>
          <input id={`${id}-why`} className="input" type="text" maxLength={CAMPAIGN_LIMITS.note} placeholder="We couldn’t tell the channel is yours." value={note} onChange={(e) => setNote(e.target.value)} />
          <p className="field-help">They can change it and send it again.</p>
        </div>
      </FormDialog>
    </>
  );
}

/** Copy a block of text (who is owed what, to send to a campaign's owner). */
export function CopyTextButton({ text, label, done }: { text: string; label: string; done: string }) {
  const toast = useToast();
  return (
    <button
      className="btn btn-secondary btn-sm"
      type="button"
      onClick={() =>
        void navigator.clipboard.writeText(text).then(
          () => toast({ tone: "success", title: done }),
          () => toast({ tone: "error", title: "Couldn’t copy", body: "Select the text and copy it by hand." }),
        )
      }
    >
      {label}
    </button>
  );
}
