"use client";

import { LockSimple } from "@phosphor-icons/react";
import { CLIP_FEATURES, planForClip, type ClipFeature } from "@/lib/clips/features";
import styles from "./clip-plan-note.module.css";

/**
 * Under a clip control that needs a plan the account doesn't have: what it is, the plan it
 * comes with, and the way to the plans. In a new tab, so the edit stays open.
 *
 * Unlike the editor's notes, these sit over something the server enforces: the control is
 * shown and disabled, so nobody waits for a render to be told.
 */
export function ClipPlanNote({ feature }: { feature: ClipFeature }) {
  return (
    <p className={styles.note} data-testid={`clip-plan-note-${feature}`}>
      <LockSimple size={14} weight="fill" aria-hidden />
      <span>
        {CLIP_FEATURES[feature].name} comes with {planForClip(feature)}.{" "}
        <a href="/pricing" target="_blank" rel="noopener">
          See the plans
        </a>
      </span>
    </p>
  );
}
