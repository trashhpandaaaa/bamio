"use client";

import { LockSimple } from "@phosphor-icons/react";
import { EDITOR_FEATURES, planFor, type EditorFeature } from "@/lib/editor/features";
import styles from "./editor.module.css";

/**
 * Under a control that needs a plan the account doesn't have: what it is, the plan it comes
 * with, and the way to the plans. In a new tab, so the edit stays open.
 */
export function PlanNote({ feature }: { feature: EditorFeature }) {
  return (
    <p className={styles.planNote} data-testid={`plan-note-${feature}`}>
      <LockSimple size={14} weight="fill" aria-hidden />
      <span>
        {EDITOR_FEATURES[feature].name} comes with {planFor(feature)}.{" "}
        <a href="/pricing" target="_blank" rel="noopener">
          See the plans
        </a>
      </span>
    </p>
  );
}
