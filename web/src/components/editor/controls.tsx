"use client";

import { useId } from "react";
import styles from "./editor.module.css";

/* The side panel's building blocks. */

/** A labelled slider. `format`: how its value reads. */
export function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className={styles.sliderLabel} htmlFor={id}>
        <span>{label}</span>
        <output>{format ? format(value) : value}</output>
      </label>
      <input id={id} className={styles.range} type="range" min={min} max={max} step={step} value={value} aria-valuetext={format ? format(value) : undefined} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      {children}
    </section>
  );
}

/** A colour of one's own, beside the swatches. */
export function ColorPick({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className={styles.colorPick}>
      <input type="color" value={value} aria-label={label} onChange={(e) => onChange(e.target.value.toUpperCase())} />
      <span>{label}</span>
    </label>
  );
}

/** A switch with its words. */
export function Switch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={styles.switchRow}>
      <span>{label}</span>
      <input className="switch" type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export const percent = (v: number) => `${Math.round(v * 100)}%`;
export const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
export const secs = (v: number) => `${v.toFixed(1)} s`;
