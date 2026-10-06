"use client";

import { UserProfile, useClerk, useUser } from "@clerk/nextjs";
import { Bell, Info, Scissors, Trash, UsersThree, WarningCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { LanguageSelect } from "@/components/language-select";
import { useSystemStatus } from "@/hooks/use-project";
import { api } from "@/lib/clips/api";
import { ASPECT_LABEL, CAPTION_STYLE_LABEL, CLIP_LENGTH_LABEL } from "@/lib/clips/labels";
import { ASPECTS, CAPTION_STYLES, CLIP_LENGTHS } from "@/lib/clips/schema";
import { clipDefaultsSchema, readClipDefaults, type ClipDefaults } from "@/lib/profile/defaults";
import { notificationsSchema, readNotifications, type Notifications } from "@/lib/profile/notifications";
import { ClipperPage } from "./clipper-form";
import styles from "./profile.module.css";

/** Clerk's profile (name, photo, emails, password, sessions) plus Bamio's clip defaults, email settings and account deletion. */
export function ProfileView() {
  return (
    <UserProfile path="/profile" routing="path">
      <UserProfile.Page label="Clip defaults" url="clip-defaults" labelIcon={<Scissors size={16} />}>
        <ClipDefaultsPage />
      </UserProfile.Page>
      <UserProfile.Page label="Notifications" url="notifications" labelIcon={<Bell size={16} />}>
        <NotificationsPage />
      </UserProfile.Page>
      <UserProfile.Page label="Clippers page" url="clippers" labelIcon={<UsersThree size={16} />}>
        <ClipperPage />
      </UserProfile.Page>
      {/* Clerk’s own Delete account is hidden (clerk-appearance.ts): this one also ends the plan and removes everything Bamio keeps. */}
      <UserProfile.Page label="Delete account" url="delete-account" labelIcon={<Trash size={16} />}>
        <DeleteAccountPage />
      </UserProfile.Page>
    </UserProfile>
  );
}

function NotificationsPage() {
  const { user, isLoaded } = useUser();
  if (!isLoaded || !user) return <div className="skeleton" style={{ height: 240 }} aria-busy="true" />;
  return <NotificationsForm key={user.id} initial={readNotifications(user.unsafeMetadata)} address={user.primaryEmailAddress?.emailAddress ?? null} />;
}

/** Which emails the user wants. The mailer reads these from the Clerk user when it sends (src/lib/server/email.ts). */
function NotificationsForm({ initial, address }: { initial: Notifications; address: string | null }) {
  const { user } = useUser();
  const toast = useToast();
  const status = useSystemStatus();
  const [values, setValues] = useState<Notifications>(initial);
  const [saved, setSaved] = useState<Notifications>(initial);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const parsed = notificationsSchema.safeParse(values);
    if (!parsed.success) return;
    setSaving(true);
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, bamioNotifications: parsed.data } });
      setSaved(parsed.data);
      toast({ tone: "success", title: "Notifications saved" });
    } catch {
      toast({ tone: "error", title: "Couldn’t save your notifications", body: "Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.defaults} onSubmit={(e) => void save(e)}>
      <div className={styles.defaultsHead}>
        <h2 className="t-heading-md">Notifications</h2>
        <p className="t-body-sm t-secondary">{address ? `Bamio emails you at ${address}. Change it under Profile.` : "Add an email address under Profile to get emails from Bamio."}</p>
      </div>

      {status && !status.email ? (
        <div className="notice" role="status">
          <Info size={18} aria-hidden />
          <p>Emails aren’t set up on this server yet, so none are sent.</p>
        </div>
      ) : null}

      <div className={styles.option}>
        <label className="choice">
          <input className="switch" type="checkbox" role="switch" name="videos" checked={values.videos} onChange={(e) => setValues((v) => ({ ...v, videos: e.target.checked }))} />
          When a video is ready, or an import fails
        </label>
        <p className="t-body-sm t-tertiary">With the best clips Bamio found and a link to them. Also when a followed stream ends.</p>
      </div>

      {status?.billing !== false ? (
        <div className={styles.option}>
          <label className="choice">
            <input className="switch" type="checkbox" role="switch" name="minutes" checked={values.minutes} onChange={(e) => setValues((v) => ({ ...v, minutes: e.target.checked }))} />
            When I’ve used most of my AI minutes
          </label>
          <p className="t-body-sm t-tertiary">At 80% of this month’s minutes, and when they run out.</p>
        </div>
      ) : null}

      <p className="t-body-sm t-secondary">Emails about your plan and payments are always sent.</p>

      <div className={styles.actions}>
        <button className="btn btn-primary" type="submit" disabled={!dirty || saving} aria-busy={saving}>
          {saving ? "Saving…" : dirty ? "Save notifications" : "Saved"}
        </button>
        {dirty && !saving ? (
          <button className="btn btn-ghost" type="button" onClick={() => setValues(saved)}>
            Undo changes
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ClipDefaultsPage() {
  const { user, isLoaded } = useUser();
  if (!isLoaded || !user) return <div className="skeleton" style={{ height: 320 }} aria-busy="true" />;
  return <ClipDefaultsForm key={user.id} initial={readClipDefaults(user.unsafeMetadata)} />;
}

function ClipDefaultsForm({ initial }: { initial: ClipDefaults }) {
  const { user } = useUser();
  const toast = useToast();
  const [values, setValues] = useState<ClipDefaults>(initial);
  const [saved, setSaved] = useState<ClipDefaults>(initial);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const set = <K extends keyof ClipDefaults>(key: K, value: ClipDefaults[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const parsed = clipDefaultsSchema.safeParse(values);
    if (!parsed.success) return;
    setSaving(true);
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, bamioClipDefaults: parsed.data } });
      setSaved(parsed.data);
      toast({ tone: "success", title: "Clip defaults saved", body: "New imports will start with these settings." });
    } catch {
      toast({ tone: "error", title: "Couldn’t save your defaults", body: "Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.defaults} onSubmit={(e) => void save(e)}>
      <div className={styles.defaultsHead}>
        <h2 className="t-heading-md">Clip defaults</h2>
        <p className="t-body-sm t-secondary">Every new import starts with these. You can still change them for each video and each clip.</p>
      </div>

      <LanguageSelect value={values.language} onChange={(code) => set("language", code)} />

      <label className="choice">
        <input className="switch" type="checkbox" role="switch" name="findClips" checked={values.findClips} onChange={(e) => set("findClips", e.target.checked)} />
        Find clips with AI after importing
      </label>

      <div className="field">
        <span className="field-label" id={`${id}-len`}>
          Clip length
        </span>
        <div className="seg" role="group" aria-labelledby={`${id}-len`}>
          {CLIP_LENGTHS.map((l) => (
            <button key={l} type="button" aria-pressed={values.clipLength === l} onClick={() => set("clipLength", l)}>
              {CLIP_LENGTH_LABEL[l]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label" id={`${id}-aspect`}>
          Format
        </span>
        <div className="seg" role="group" aria-labelledby={`${id}-aspect`}>
          {ASPECTS.map((a) => (
            <button key={a} type="button" aria-pressed={values.aspect === a} onClick={() => set("aspect", a)}>
              {ASPECT_LABEL[a]}
            </button>
          ))}
        </div>
      </div>

      <label className="choice">
        <input className="switch" type="checkbox" role="switch" name="captions" checked={values.captions} onChange={(e) => set("captions", e.target.checked)} />
        Captions on new clips
      </label>

      <div className="field">
        <span className="field-label" id={`${id}-style`}>
          Caption style
        </span>
        <div className={styles.chips} role="group" aria-labelledby={`${id}-style`}>
          {CAPTION_STYLES.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={values.captionStyle === s} disabled={!values.captions} onClick={() => set("captionStyle", s)}>
              {CAPTION_STYLE_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.actions}>
        <button className="btn btn-primary" type="submit" disabled={!dirty || saving} aria-busy={saving}>
          {saving ? "Saving…" : dirty ? "Save defaults" : "Saved"}
        </button>
        {dirty && !saving ? (
          <button className="btn btn-ghost" type="button" onClick={() => setValues(saved)}>
            Undo changes
          </button>
        ) : null}
      </div>
    </form>
  );
}

/**
 * Deletes the account and everything Bamio keeps about it (src/lib/server/accounts.ts): the
 * plan ends at once, then projects, media and every record go, then the Clerk user.
 */
function DeleteAccountPage() {
  const { signOut } = useClerk();
  const router = useRouter();
  const toast = useToast();
  const billing = useSystemStatus()?.billing ?? false;
  const [understood, setUnderstood] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    setConfirming(false);
    setDeleting(true);
    try {
      await api.deleteAccount();
    } catch (err) {
      setDeleting(false);
      toast({ tone: "error", title: "Couldn’t delete your account", body: err instanceof Error ? err.message : "Check your connection and try again." });
      return;
    }
    // The Clerk user is gone already; signing out clears what the browser still holds.
    await signOut({ redirectUrl: "/?account=deleted" }).catch(() => router.replace("/?account=deleted"));
  }

  return (
    <div className={styles.defaults}>
      <div className={styles.defaultsHead}>
        <h2 className="t-heading-md">Delete account</h2>
        <p className="t-body-sm t-secondary">This deletes your Bamio account and everything in it, for good. It can’t be undone.</p>
      </div>
      <ul className={styles.deleteList}>
        <li>Your projects, uploaded and imported videos, transcripts, clips and exports.</li>
        {billing ? <li>Your plan ends now, with no refund for the time left, and your card is removed. Past invoices stay with Stripe.</li> : null}
        <li>Your settings, referral link and the emails Bamio sent you.</li>
      </ul>
      <p className="t-body-sm t-secondary">Download any clips you want to keep first.</p>
      <label className={`choice ${styles.confirm}`}>
        <input className="check" type="checkbox" checked={understood} disabled={deleting} onChange={(e) => setUnderstood(e.target.checked)} />I understand this deletes everything
      </label>
      <div className={styles.actions}>
        <button className="btn btn-danger" type="button" disabled={!understood || deleting} aria-busy={deleting} onClick={() => setConfirming(true)}>
          <WarningCircle size={18} aria-hidden />
          {deleting ? "Deleting…" : "Delete my account"}
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Delete your account?"
        body="Everything goes now: projects, videos, clips and your plan. This can’t be undone."
        confirmLabel="Delete everything"
        cancelLabel="Keep my account"
        destructive
        onClose={() => setConfirming(false)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
