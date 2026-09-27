"use client";

import { UserProfile, useUser } from "@clerk/nextjs";
import { CaretDown, FilmSlate } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { useToast } from "@/components/toast";
import { readVideoDefaults, videoDefaultsSchema, type VideoDefaults } from "@/lib/profile/defaults";
import { DURATIONS, TONES, VOICES, type Tone } from "@/lib/project/schema";
import styles from "./profile.module.css";

const TONE_LABEL: Record<Tone, string> = { funny: "Funny", bold: "Bold", calm: "Calm", heartfelt: "Heartfelt", educational: "Educational" };

/** Clerk's profile (name, photo, emails, password, sessions) plus Bamio's video defaults. */
export function ProfileView() {
  return (
    <UserProfile path="/profile" routing="path">
      <UserProfile.Page label="Video defaults" url="video-defaults" labelIcon={<FilmSlate size={16} />}>
        <VideoDefaultsPage />
      </UserProfile.Page>
    </UserProfile>
  );
}

function VideoDefaultsPage() {
  const { user, isLoaded } = useUser();
  if (!isLoaded || !user) return <div className="skeleton" style={{ height: 320 }} aria-busy="true" />;
  return <VideoDefaultsForm key={user.id} initial={readVideoDefaults(user.unsafeMetadata)} />;
}

function VideoDefaultsForm({ initial }: { initial: VideoDefaults }) {
  const { user } = useUser();
  const toast = useToast();
  const [values, setValues] = useState<VideoDefaults>(initial);
  const [saved, setSaved] = useState<VideoDefaults>(initial);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const dirty = JSON.stringify(values) !== JSON.stringify(saved);
  const set = <K extends keyof VideoDefaults>(key: K, value: VideoDefaults[K]) => setValues((v) => ({ ...v, [key]: value }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const parsed = videoDefaultsSchema.safeParse(values);
    if (!parsed.success) return;
    setSaving(true);
    try {
      await user.update({ unsafeMetadata: { ...user.unsafeMetadata, bamioDefaults: parsed.data } });
      setSaved(parsed.data);
      toast({ tone: "success", title: "Video defaults saved", body: "New videos will start with these settings." });
    } catch {
      toast({ tone: "error", title: "Couldn’t save your defaults", body: "Check your connection and try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className={styles.defaults} onSubmit={(e) => void save(e)}>
      <div className={styles.defaultsHead}>
        <h2 className="t-heading-md">Video defaults</h2>
        <p className="t-body-sm t-secondary">Every new video starts with these. You can still change them for each video.</p>
      </div>

      <div className="field">
        <span className="field-label" id={`${id}-len`}>
          Length
        </span>
        <div className="seg" role="group" aria-labelledby={`${id}-len`}>
          {DURATIONS.map((d) => (
            <button key={d} type="button" aria-pressed={values.durationSec === d} onClick={() => set("durationSec", d)}>
              {d} sec
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label" id={`${id}-tone`}>
          Tone
        </span>
        <div className={styles.chips} role="group" aria-labelledby={`${id}-tone`}>
          {TONES.map((t) => (
            <button key={t} type="button" className="chip" aria-pressed={values.tone === t} onClick={() => set("tone", t)}>
              {TONE_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      <label className="choice">
        <input className="switch" type="checkbox" role="switch" name="voiceover" checked={values.voiceover} onChange={(e) => set("voiceover", e.target.checked)} />
        AI voice-over
      </label>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-voice`}>
          Voice
        </label>
        <div className="select-wrap">
          <select
            id={`${id}-voice`}
            className="select"
            name="voice"
            value={values.voice}
            disabled={!values.voiceover}
            onChange={(e) => set("voice", e.target.value as VideoDefaults["voice"])}
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.id}, {v.label.toLowerCase()}
              </option>
            ))}
          </select>
          <CaretDown size={16} aria-hidden />
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
