"use client";

import { useUser } from "@clerk/nextjs";
import { WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/clips/api";
import { CAMPAIGN_LIMITS, clipperInputSchema, type MyClipper } from "@/lib/campaigns/schema";
import styles from "./profile.module.css";

type Values = { name: string; link: string; payout: string };

/**
 * Profile, Clipper details: who the user is in clipping campaigns (/clippers). The name and
 * channel show on leaderboards; how to pay them is for Bamio's team and campaign owners only.
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

function ClipperForm({ entry, fallbackName, onSaved }: { entry: MyClipper | null; fallbackName: string; onSaved: (entry: MyClipper) => void }) {
  const toast = useToast();
  const id = useId();
  const start: Values = { name: entry?.name ?? fallbackName, link: entry?.link ?? "", payout: entry?.payout ?? "" };
  const [values, setValues] = useState<Values>(start);
  const [saved, setSaved] = useState<Values | null>(entry ? start : null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof Values, string>>>({});
  const dirty = saved === null || JSON.stringify(values) !== JSON.stringify(saved);
  const set = (key: keyof Values, value: string) => setValues((v) => ({ ...v, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const parsed = clipperInputSchema.safeParse(values);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setSaving(true);
    try {
      const next = await api.clipper.save(parsed.data);
      onSaved(next);
      const now: Values = { name: next.name, link: next.link, payout: next.payout };
      setValues(now);
      setSaved(now);
      toast({ tone: "success", title: "Clipper details saved" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t save", body: err instanceof Error ? err.message : "Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.defaults} onSubmit={(e) => void save(e)} noValidate>
      <div className={styles.defaultsHead}>
        <h2 className="t-heading-md">Clipper details</h2>
        <p className="t-body-sm t-secondary">
          Who you are in{" "}
          <Link className={styles.inlineLink} href="/clippers">
            clipping campaigns
          </Link>
          : you post clips on your own channel and earn for their views.
        </p>
      </div>

      {entry?.blocked ? (
        <div className="notice is-warning" role="status">
          <WarningCircle size={18} weight="fill" aria-hidden />
          <p>
            <strong>Your account can’t take part in campaigns</strong>
            Bamio’s team turned this off for your account.
          </p>
        </div>
      ) : null}

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
          disabled={saving}
          aria-invalid={errors.name ? true : undefined}
          aria-describedby={`${id}-name-help`}
          onChange={(e) => set("name", e.target.value)}
        />
        <p id={`${id}-name-help`} className={errors.name ? "field-error" : "field-help"} role={errors.name ? "alert" : undefined}>
          {errors.name ?? "Shown on campaign leaderboards, with your profile picture."}
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
          disabled={saving}
          aria-invalid={errors.link ? true : undefined}
          aria-describedby={`${id}-link-help`}
          onChange={(e) => set("link", e.target.value)}
        />
        <p id={`${id}-link-help`} className={errors.link ? "field-error" : "field-help"} role={errors.link ? "alert" : undefined}>
          {errors.link ?? "Where you post your clips: TikTok, YouTube, Instagram, X, Twitch or Kick. Shown beside your name."}
        </p>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-payout`}>
          How to pay you
        </label>
        <input
          id={`${id}-payout`}
          className="input"
          type="text"
          autoComplete="off"
          maxLength={CAMPAIGN_LIMITS.payout}
          placeholder="PayPal: you@example.com"
          value={values.payout}
          disabled={saving}
          aria-invalid={errors.payout ? true : undefined}
          aria-describedby={`${id}-payout-help`}
          onChange={(e) => set("payout", e.target.value)}
        />
        <p id={`${id}-payout-help`} className={errors.payout ? "field-error" : "field-help"} role={errors.payout ? "alert" : undefined}>
          {errors.payout ?? "Campaign owners pay you directly, not through Bamio. Only Bamio’s team and they see this. Never a card number or a password."}
        </p>
      </div>

      <div className={styles.actions}>
        <button className="btn btn-primary" type="submit" disabled={!dirty || saving} aria-busy={saving}>
          {saving ? "Saving…" : dirty ? "Save details" : "Saved"}
        </button>
        {dirty && saved && !saving ? (
          <button className="btn btn-ghost" type="button" onClick={() => setValues(saved)}>
            Undo changes
          </button>
        ) : null}
      </div>
    </form>
  );
}
