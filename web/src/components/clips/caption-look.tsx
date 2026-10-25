"use client";

import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useId } from "react";
import { ClipPlanNote } from "@/components/clips/clip-plan-note";
import { CAPTION_COLOR_DEFAULT, CAPTION_HIGHLIGHT_DEFAULT } from "@/lib/clips/ass";
import type { CaptionLook, CaptionStyle } from "@/lib/clips/schema";
import styles from "./caption-look.module.css";

/*
 * A caption look of one's own (Pro: "Custom caption styling"), over whichever of the three
 * styles is chosen: colours, size, outline, capitals, and picking out the words said loudest.
 *
 * Every field is optional and an unset one means the style's own value, so a clip nobody has
 * touched here renders exactly as it always did. Reset clears the lot rather than writing the
 * current defaults in, which keeps that true.
 */

export function CaptionLookControls({
  look,
  style,
  disabled,
  locked,
  onChange,
}: {
  look: CaptionLook | undefined;
  style: CaptionStyle;
  /** The captions are switched off: the controls are there but inert. */
  disabled?: boolean;
  /** The plan doesn't include it. */
  locked?: boolean;
  onChange: (look: CaptionLook | undefined) => void;
}) {
  const id = useId();
  const off = Boolean(disabled || locked);
  const set = (patch: CaptionLook) => {
    const next = { ...look, ...patch };
    // Drop the fields that are back at their default, so "nothing of my own" stays expressible.
    for (const key of Object.keys(next) as (keyof CaptionLook)[]) if (next[key] === undefined) delete next[key];
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  const own = look !== undefined && Object.values(look).some((v) => v !== undefined);

  return (
    <div className={styles.look}>
      <div className={styles.colors}>
        <label className={styles.colorPick}>
          <input
            type="color"
            value={look?.color ?? CAPTION_COLOR_DEFAULT}
            disabled={off}
            onChange={(e) => set({ color: e.target.value.toUpperCase() })}
            aria-label="Caption colour"
          />
          <span>Words</span>
        </label>
        <label className={styles.colorPick}>
          <input
            type="color"
            value={look?.highlight ?? CAPTION_HIGHLIGHT_DEFAULT}
            disabled={off}
            onChange={(e) => set({ highlight: e.target.value.toUpperCase() })}
            aria-label="Highlight colour"
          />
          <span>{style === "pop" ? "Spoken word" : "Loud words"}</span>
        </label>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-size`}>
          Size <span className="t-mono t-tertiary">{look?.sizePct ?? 100}%</span>
        </label>
        <input
          id={`${id}-size`}
          className={styles.range}
          type="range"
          min={60}
          max={160}
          step={5}
          value={look?.sizePct ?? 100}
          disabled={off}
          onChange={(e) => set({ sizePct: Number(e.target.value) })}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${id}-outline`}>
          Outline <span className="t-mono t-tertiary">{look?.outlinePct ?? 100}%</span>
        </label>
        <input
          id={`${id}-outline`}
          className={styles.range}
          type="range"
          min={0}
          max={250}
          step={10}
          value={look?.outlinePct ?? 100}
          disabled={off}
          onChange={(e) => set({ outlinePct: Number(e.target.value) })}
        />
      </div>

      <label className={styles.switchRow}>
        <span>ALL CAPS</span>
        <input className="switch" type="checkbox" role="switch" checked={look?.uppercase ?? false} disabled={off} onChange={(e) => set({ uppercase: e.target.checked || undefined })} />
      </label>

      <label className={styles.switchRow}>
        <span>Pick out the loud words</span>
        <input className="switch" type="checkbox" role="switch" checked={look?.loudWords ?? false} disabled={off} onChange={(e) => set({ loudWords: e.target.checked || undefined })} />
      </label>
      <p className="field-help">
        {style === "pop"
          ? "In Pop the word being spoken is always coloured; this keeps the loud ones coloured after they are said."
          : "The words said louder than most of the clip get the highlight colour. Nothing is marked when the sound hardly varies."}
      </p>

      {own && !locked ? (
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => onChange(undefined)}>
          <ArrowCounterClockwise size={16} aria-hidden /> Back to the style’s own look
        </button>
      ) : null}
      {locked ? <ClipPlanNote feature="captionStyle" /> : null}
    </div>
  );
}
