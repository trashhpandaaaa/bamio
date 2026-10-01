"use client";

import { Pause, Play } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { CAPTION_POSITION_LABEL, CAPTION_STYLE_HELP, CAPTION_STYLE_LABEL } from "@/lib/clips/labels";
import { CAPTION_POSITIONS, CAPTION_STYLES, type CaptionPosition, type CaptionStyle } from "@/lib/clips/schema";
import { useInView, useReducedMotion } from "@/hooks/use-motion";
import { DemoCaption, DemoTitle } from "./demo-caption";
import { FilmstripFrame, FOCUS, FootageCrop } from "./footage";
import styles from "./caption-studio.module.css";

/*
 * A working miniature of the clip editor: the preview plays a clip's captions, and the
 * style, position and title controls change it the way they do in the editor (and the
 * export). The words below follow along; picking one jumps there.
 */

const LINES = [["nobody", "tells", "you"], ["this", "part", "of"], ["streaming"], ["the", "clip", "that"], ["changed", "everything"]];
const WORDS = LINES.flatMap((line, l) => line.map((text, w) => ({ text, l, w })));
const WORD_MS = 430;
/** One pass: every word, then a short rest on the last. */
const LOOP = WORDS.length + 3;
const CLIP_SEC = 15;
/** Where the clip sits in the source, as shares of the trim bar. */
const TRIM = { start: 0.2, end: 0.76 };
/** The filmstrip: ten frames across the episode. */
const FILMSTRIP = Array.from({ length: 10 }, (_, i) => i);

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;

export function CaptionStudio() {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const visible = useInView(root, { threshold: 0.2 });
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>("pop");
  const [position, setPosition] = useState<CaptionPosition>("bottom");
  const [showTitle, setShowTitle] = useState(true);
  /** Counts up while playing: the word is tick % LOOP, and each loop remounts the playhead so it jumps back. */
  const [tick, setTick] = useState(0);
  // Plays on its own unless the visitor asked for less motion; the play button decides after that.
  const [choice, setChoice] = useState<"play" | "pause" | null>(null);
  const playing = (choice ?? (reduce ? "pause" : "play")) === "play";

  useEffect(() => {
    if (!playing || !visible) return;
    const timer = setInterval(() => setTick((t) => t + 1), WORD_MS);
    return () => clearInterval(timer);
  }, [playing, visible]);

  const loop = Math.floor(tick / LOOP);
  const step = tick % LOOP;
  const at = WORDS[Math.min(step, WORDS.length - 1)]!;
  const line = LINES[at.l]!;
  const progress = Math.min(step, WORDS.length - 1) / (WORDS.length - 1);

  return (
    <div className={styles.frame}>
      <div ref={root} className={`studio ${styles.panel}`}>
        <div className={styles.stage}>
          <div className={styles.preview} role="img" aria-label={`Preview: a vertical clip with ${CAPTION_STYLE_LABEL[captionStyle]} captions${showTitle ? " and a title" : ""}.`}>
            <FootageCrop name="podcast" focus={FOCUS.podcast.left} at={3} play={playing} />
            {showTitle ? <DemoTitle>nobody tells you this</DemoTitle> : null}
            <DemoCaption words={line} active={at.w} captionStyle={captionStyle} position={position} />
          </div>
        </div>

        <div className={styles.inspector}>
          <div className={styles.group}>
            <h3 className={styles.label} id={`${id}-style`}>
              Caption style
            </h3>
            <div className="seg" role="group" aria-labelledby={`${id}-style`}>
              {CAPTION_STYLES.map((s) => (
                <button key={s} type="button" aria-pressed={captionStyle === s} onClick={() => setCaptionStyle(s)}>
                  {CAPTION_STYLE_LABEL[s]}
                </button>
              ))}
            </div>
            <p className={styles.help}>{CAPTION_STYLE_HELP[captionStyle]}.</p>
          </div>
          <div className={styles.group}>
            <h3 className={styles.label} id={`${id}-position`}>
              Position
            </h3>
            <div className="seg" role="group" aria-labelledby={`${id}-position`}>
              {CAPTION_POSITIONS.map((p) => (
                <button key={p} type="button" aria-pressed={position === p} onClick={() => setPosition(p)}>
                  {CAPTION_POSITION_LABEL[p]}
                </button>
              ))}
            </div>
          </div>
          <label className={`choice ${styles.switchRow}`}>
            <input className="switch" type="checkbox" role="switch" checked={showTitle} onChange={(e) => setShowTitle(e.target.checked)} />
            Show a title
          </label>
          <div className={styles.group}>
            <h3 className={styles.label} id={`${id}-words`}>
              Caption words
            </h3>
            <p className={styles.words} role="group" aria-labelledby={`${id}-words`}>
              {WORDS.map((w, i) => (
                <button
                  key={i}
                  type="button"
                  className={styles.word}
                  data-now={i === Math.min(step, WORDS.length - 1) ? "" : undefined}
                  aria-label={`Jump to “${w.text}”`}
                  onClick={() => setTick(loop * LOOP + i)}
                >
                  {w.text}
                </button>
              ))}
            </p>
            <p className={styles.help}>Every word has its time. Fix a misheard one and the export follows.</p>
          </div>
        </div>

        <div className={styles.transport}>
          <button className="btn btn-primary btn-icon" type="button" aria-label={playing ? "Pause the example" : "Play the example"} onClick={() => setChoice(playing ? "pause" : "play")}>
            {playing ? <Pause size={18} weight="fill" aria-hidden /> : <Play size={18} weight="fill" aria-hidden />}
          </button>
          <span className={styles.clock} aria-hidden="true">
            <b>{clock(progress * CLIP_SEC)}</b> / {clock(CLIP_SEC)}
          </span>
          <div className={styles.trim} aria-hidden="true">
            <div className={styles.filmstrip}>
              {FILMSTRIP.map((i) => (
                <span key={i} className={styles.frame}>
                  <FilmstripFrame frame={i} />
                </span>
              ))}
            </div>
            <span className={styles.shade} style={{ left: 0, width: `${TRIM.start * 100}%` }} />
            <span className={styles.shade} style={{ left: `${TRIM.end * 100}%`, right: 0 }} />
            <span className={styles.range} style={{ left: `${TRIM.start * 100}%`, width: `${(TRIM.end - TRIM.start) * 100}%` }} />
            <span className={styles.handle} data-edge="start" style={{ left: `${TRIM.start * 100}%` }} />
            <span className={styles.handle} data-edge="end" style={{ left: `${TRIM.end * 100}%` }} />
            <span key={loop} className={styles.headTrack} style={{ transform: `translateX(${(TRIM.start + progress * (TRIM.end - TRIM.start)) * 100}%)` }}>
              <span className={styles.head} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
