"use client";

import { UserProfile, useUser } from "@clerk/nextjs";
import { Scissors } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useToast } from "@/components/toast";
import { LanguageSelect } from "@/components/language-select";
import { ASPECT_LABEL, CAPTION_STYLE_LABEL, CLIP_LENGTH_LABEL } from "@/lib/clips/labels";
import { ASPECTS, CAPTION_STYLES, CLIP_LENGTHS } from "@/lib/clips/schema";
import { clipDefaultsSchema, readClipDefaults, type ClipDefaults } from "@/lib/profile/defaults";
import styles from "./profile.module.css";

/** Clerk's profile (name, photo, emails, password, sessions) plus Bamio's clip defaults. */
export function ProfileView() {
  return (
    <UserProfile path="/profile" routing="path">
      <UserProfile.Page label="Clip defaults" url="clip-defaults" labelIcon={<Scissors size={16} />}>
        <ClipDefaultsPage />
      </UserProfile.Page>
    </UserProfile>
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
