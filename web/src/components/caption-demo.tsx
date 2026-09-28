"use client";

import { Pause, Play } from "@phosphor-icons/react";
import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import { AiMark } from "@/components/brand";
import styles from "./caption-demo.module.css";

/* A 9:16 frame on the landing page that shows the "pop" caption style running. */

const LINES = [
  ["nobody", "tells", "you"],
  ["this", "part", "of"],
  ["streaming"],
  ["the", "clip", "that"],
  ["changed", "everything"],
];
const WORDS = LINES.flatMap((line, l) => line.map((_, w) => ({ l, w })));

const reducedMotion = {
  subscribe: (cb: () => void) => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  },
  get: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

export function CaptionDemo() {
  const reduce = useSyncExternalStore(reducedMotion.subscribe, reducedMotion.get, () => false);
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(0);
  const running = !reduce && !paused;

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setStep((s) => (s + 1) % WORDS.length), 420);
    return () => clearInterval(timer);
  }, [running]);

  const at = running ? WORDS[step]! : { l: 0, w: LINES[0]!.length - 1 };
  const line = LINES[at.l]!;

  return (
    <figure className={`studio ${styles.frame}`} aria-label="Example clip with word-by-word captions">
      <div className={styles.scene} aria-hidden="true">
        <span className={styles.glow} />
        <span className={styles.subject} />
        <span className={styles.badge}>
          <AiMark size={12} /> 94
        </span>
        <p className={styles.caption}>
          {line.map((word, i) => (
            <Fragment key={`${at.l}-${i}`}>
              <span className={i < at.w ? styles.past : i === at.w ? styles.now : styles.next}>{word}</span>
              {i < line.length - 1 ? " " : null}
            </Fragment>
          ))}
        </p>
        <span className={styles.bar}>
          <span style={{ width: `${((step + 1) / WORDS.length) * 100}%` }} />
        </span>
      </div>
      {!reduce ? (
        <button className={`btn btn-icon btn-sm ${styles.control}`} type="button" aria-label={paused ? "Play the example" : "Pause the example"} onClick={() => setPaused((p) => !p)}>
          {paused ? <Play size={16} weight="fill" aria-hidden /> : <Pause size={16} weight="fill" aria-hidden />}
        </button>
      ) : null}
    </figure>
  );
}
