"use client";

import { useUser } from "@clerk/nextjs";
import { CheckCircle, Clock, EyeSlash, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/clips/api";
import { CLIPPER_LIMITS, clipperInputSchema, type MyClipper } from "@/lib/profile/clipper";
import styles from "./profile.module.css";

type Values = { listed: boolean; name: string; bio: string; link: string };

/**
 * Profile, Clippers page: the switch that lists the user on /clippers, and what their card
 * says. Saving sends it to Bamio's team (it shows once approved); turning the switch off and
 * saving takes it down at once.
 */
export function ClipperPage() {
  const { user, isLoaded } = useUser();
  const [entry, setEntry] = useState<MyClipper | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api.clipper.get(controller.signal).then(setEntry, (err: unknown) => {
      if (!(err instanceof Error && err.name === "AbortError")) setFailed(true);
    });
    return () => controller.abort();
  }, []);

  if (failed) {
    return (
      <div className="notice is-error" role="alert">
        <WarningCircle size={20} weight="fill" aria-hidden />
        <p>
          <strong>Couldn’t load this page</strong>
          Check your connection and reload.
        </p>
      </div>
    );
  }
  if (!isLoaded || !user || entry === undefined) return <div className="skeleton" style={{ height: 320 }} aria-busy="true" />;
  const fallbackName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "";
  return <ClipperForm key={user.id} entry={entry} fallbackName={fallbackName} onSaved={setEntry} />;
}

function ClipperForm({ entry, fallbackName, onSaved }: { entry: MyClipper | null; fallbackName: string; onSaved: (entry: MyClipper | null) => void }) {
  const toast = useToast();
  const id = useId();
  const start: Values = { listed: entry !== null, name: entry?.name ?? fallbackName, bio: entry?.bio ?? "", link: entry?.link ?? "" };
  const [values, setValues] = useState<Values>(start);
  const [saved, setSaved] = useState<Values>(start);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<"name" | "bio" | "link", string>>>({});
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setSaving(true);
    try {
      if (!values.listed) {
        await api.clipper.remove();
        onSaved(null);
        setSaved(values);
        toast({ tone: "success", title: "You’re off the Clippers page" });
        return;
      }
      const parsed = clipperInputSchema.safeParse({ name: values.name, bio: values.bio, link: values.link });
      if (!parsed.success) {
        setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
        return;
      }
      const next = await api.clipper.save(parsed.data);
      onSaved(next);
      const now: Values = { listed: true, name: next.name, bio: next.bio, link: next.link };
      setValues(now);
      setSaved(now);
      toast(
        next.status === "approved"
          ? { tone: "success", title: "Saved", body: "Your card on the Clippers page is up to date." }
          : { tone: "success", title: "Sent for a look", body: "Bamio’s team checks every card first. You’ll get an email when yours is live." },
      );
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t save", body: err instanceof Error ? err.message : "Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.defaults} onSubmit={(e) => void save(e)} noValidate>
      <div className={styles.defaultsHead}>
        <h2 className="t-heading-md">Clippers page</h2>
        <p className="t-body-sm t-secondary">
          Bamio’s{" "}
          <Link className={styles.inlineLink} href="/clippers">
            public page of clippers
          </Link>
          : a card with your picture, a name, a line about you and a link to your channel, so creators can find you.
        </p>
      </div>

      {entry && saved.listed ? <Status status={entry.status} /> : null}

      <div className={styles.option}>
        <label className="choice">
          <input className="switch" type="checkbox" role="switch" name="listed" checked={values.listed} disabled={saving} onChange={(e) => set("listed", e.target.checked)} />
          Show me on the Clippers page
        </label>
        <p className="t-body-sm t-tertiary">Everyone can see it, with the number of clips you’ve exported. Turn it off any time.</p>
      </div>

      {values.listed ? (
        <>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-name`}>
              Name on your card
            </label>
            <input
              id={`${id}-name`}
              className="input"
              type="text"
              autoComplete="nickname"
              maxLength={CLIPPER_LIMITS.name}
              value={values.name}
              disabled={saving}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? `${id}-name-error` : undefined}
              onChange={(e) => set("name", e.target.value)}
            />
            {errors.name ? (
              <p id={`${id}-name-error`} className="field-error" role="alert">
                {errors.name}
              </p>
            ) : null}
          </div>

          <div className="field">
            <label className="field-label" htmlFor={`${id}-bio`}>
              A line about you
            </label>
            <textarea
              id={`${id}-bio`}
              className={`textarea ${styles.bio}`}
              rows={2}
              maxLength={CLIPPER_LIMITS.bio}
              placeholder="I clip FPS streams and podcasts, mostly for TikTok."
              value={values.bio}
              disabled={saving}
              aria-invalid={errors.bio ? true : undefined}
              aria-describedby={`${id}-bio-help`}
              onChange={(e) => set("bio", e.target.value)}
            />
            <p id={`${id}-bio-help`} className={errors.bio ? "field-error" : "field-help"} role={errors.bio ? "alert" : undefined}>
              {errors.bio ?? `${values.bio.length} of ${CLIPPER_LIMITS.bio} characters`}
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
              maxLength={CLIPPER_LIMITS.link}
              placeholder="twitch.tv/yourname"
              value={values.link}
              disabled={saving}
              aria-invalid={errors.link ? true : undefined}
              aria-describedby={`${id}-link-help`}
              onChange={(e) => set("link", e.target.value)}
            />
            <p id={`${id}-link-help`} className={errors.link ? "field-error" : "field-help"} role={errors.link ? "alert" : undefined}>
              {errors.link ?? "YouTube, Twitch, Kick, TikTok, Instagram or X. Leave it empty for no link."}
            </p>
          </div>

          <p className="t-body-sm t-secondary">Bamio’s team looks at every card before it shows, and again after you change it.</p>
        </>
      ) : null}

      <div className={styles.actions}>
        <button className="btn btn-primary" type="submit" disabled={!dirty || saving} aria-busy={saving}>
          {saving ? "Saving…" : !dirty ? "Saved" : values.listed ? (saved.listed ? "Save changes" : "Ask to be listed") : "Take me off the page"}
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

function Status({ status }: { status: MyClipper["status"] }) {
  if (status === "approved") {
    return (
      <div className="notice" role="status">
        <CheckCircle size={18} weight="fill" aria-hidden />
        <p>
          <strong>You’re on the Clippers page</strong>
        </p>
      </div>
    );
  }
  if (status === "hidden") {
    return (
      <div className="notice is-warning" role="status">
        <EyeSlash size={18} aria-hidden />
        <p>
          <strong>Your card isn’t shown</strong>
          Bamio’s team took it down. Change it and save to ask again.
        </p>
      </div>
    );
  }
  return (
    <div className="notice" role="status">
      <Clock size={18} aria-hidden />
      <p>
        <strong>Waiting for a look</strong>
        Bamio’s team checks every card before it shows. You’ll get an email when yours is live.
      </p>
    </div>
  );
}
