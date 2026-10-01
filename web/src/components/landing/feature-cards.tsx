"use client";

import { Pause, Play, TwitchLogo } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { AiMark } from "@/components/brand";
import { languageName } from "@/lib/clips/languages";
import { useInView, useReducedMotion } from "@/hooks/use-motion";
import { DemoCaption } from "./demo-caption";
import { Scene, SceneCrop } from "./scene";
import styles from "./feature-cards.module.css";

/* The two cards under "every language": captions in many scripts, and following a live stream. */

/** "Let's start today's video", as creators say it. Nepali mixes in English, as speakers often do. */
const SAMPLES = [
  { lang: "ne", words: ["okay", "guys,", "आजको", "भिडियो", "सुरु", "गरौं"] },
  { lang: "hi", words: ["आज", "का", "वीडियो", "शुरू", "करते", "हैं"] },
  { lang: "ja", words: ["今日の", "動画を", "始めましょう"] },
  { lang: "ar", words: ["لنبدأ", "فيديو", "اليوم"] },
  { lang: "es", words: ["Empecemos", "el", "video", "de", "hoy."] },
  { lang: "en", words: ["Let’s", "start", "today’s", "video."] },
];

export function LanguageCard() {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const visible = useInView(root, { threshold: 0.3 });
  const [index, setIndex] = useState(0);
  // Cycles through the languages until the visitor picks one or pauses.
  const [auto, setAuto] = useState(true);
  const cycling = auto && !reduce && visible;

  useEffect(() => {
    if (!cycling) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % SAMPLES.length), 2600);
    return () => clearInterval(timer);
  }, [cycling]);

  return (
    <div ref={root} className={`studio ${styles.media}`}>
      <div className={styles.langRow}>
        <div className={styles.chips} role="group" aria-labelledby={`${id}-label`}>
          <span id={`${id}-label`} className="sr-only">
            Show captions in
          </span>
          {SAMPLES.map((s, i) => (
            <button
              key={s.lang}
              type="button"
              className="chip"
              aria-pressed={i === index}
              onClick={() => {
                setIndex(i);
                setAuto(false);
              }}
            >
              {languageName(s.lang)}
            </button>
          ))}
        </div>
        {!reduce ? (
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={auto ? "Stop changing languages" : "Keep changing languages"} onClick={() => setAuto((a) => !a)}>
            {auto ? <Pause size={16} weight="fill" aria-hidden /> : <Play size={16} weight="fill" aria-hidden />}
          </button>
        ) : null}
      </div>
      <div className={styles.phones}>
        {([-1, 0, 1] as const).map((offset) => {
          const s = SAMPLES[(index + offset + SAMPLES.length) % SAMPLES.length]!;
          const center = offset === 0;
          return (
            <div
              key={offset}
              className={styles.phone}
              data-pos={center ? "center" : offset < 0 ? "left" : "right"}
              role={center ? "img" : undefined}
              aria-label={center ? `A clip captioned in ${languageName(s.lang)}: ${s.words.join(" ")}` : undefined}
              aria-hidden={center ? undefined : true}
            >
              <SceneCrop focus={center ? 0.715 : 0.285} />
              {center ? (
                <span className={styles.detected}>
                  <AiMark size={11} /> {languageName(s.lang)}, detected
                </span>
              ) : null}
              <DemoCaption words={s.words} active={-1} captionStyle="pop" lang={s.lang} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function LiveCard() {
  const root = useRef<HTMLDivElement>(null);
  const seen = useInView(root, { once: true, threshold: 0.4 });
  return (
    <div ref={root} className={`studio ${styles.media} ${styles.live}`} data-seen={seen ? "" : undefined} role="img" aria-label="A live stream being followed: the part captured so far grows toward the live edge, with two clips marked on it.">
      <div className={styles.stream} aria-hidden="true">
        <Scene />
        <span className={`badge is-live ${styles.liveBadge}`}>Live</span>
        <span className={styles.streamChip}>
          <TwitchLogo size={14} weight="fill" /> Friday stream
        </span>
      </div>
      <div className={styles.follow} aria-hidden="true">
        <div className={styles.followHead}>
          <span>Captured from the start</span>
          <span className={styles.mono}>2:14:05</span>
        </div>
        <div className={styles.liveTrack}>
          <span className={styles.captured} />
          <span className={styles.liveClip} style={{ left: "22%", width: "9%" }} />
          <span className={styles.liveClip} style={{ left: "58%", width: "7%" }} />
          <span className={styles.edgeTrack}>
            <span className={styles.edge} />
          </span>
        </div>
        <div className={styles.followHead}>
          <span>Captions ready up to 2:13:20</span>
          <span className={styles.hint}>Clip while it’s on</span>
        </div>
      </div>
    </div>
  );
}
