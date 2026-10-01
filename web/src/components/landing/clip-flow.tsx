"use client";

import { ArrowRight, InstagramLogo, Pause, Play, TiktokLogo, TwitchLogo, YoutubeLogo } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { AiMark } from "@/components/brand";
import { useInView, useReducedMotion, useTicker } from "@/hooks/use-motion";
import { DemoCaption } from "./demo-caption";
import { Scene, SceneCrop } from "./scene";
import styles from "./clip-flow.module.css";

/*
 * The hero's demo: a long stream in, three vertical clips out. When it first comes into
 * view, a playhead scans the stream and each moment Bamio picks lands as a clip; then the
 * clips play their captions in turn. Reduced motion shows the finished state.
 */

type Pick = { at: number; len: number; score: number; title: string; length: string; framing: { focus: number } | "fit"; lines: string[][] };

const PICKS: Pick[] = [
  { at: 0.17, len: 0.06, score: 94, title: "The clutch nobody saw coming", length: "0:17", framing: { focus: 0.285 }, lines: [["wait", "for", "it"], ["nobody", "saw", "that", "coming"]] },
  { at: 0.46, len: 0.07, score: 88, title: "Why I quit my job to stream", length: "0:52", framing: { focus: 0.715 }, lines: [["I", "quit", "my", "job"], ["to", "do", "this", "full", "time"]] },
  { at: 0.75, len: 0.05, score: 81, title: "Chat roasts my setup", length: "0:29", framing: "fit", lines: [["chat", "said", "my", "setup"], ["looks", "like", "a", "cave"]] },
];
/** Word steps per clip: every word of both lines. */
const STEPS = PICKS.map((p) => p.lines.flat().length);
const SCAN_MS = 3600;
const WORD_MS = 380;

export function ClipFlow() {
  const root = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const seen = useInView(root, { once: true, threshold: 0.3 });
  const visible = useInView(root, { threshold: 0.1 });
  const [found, setFound] = useState(0);
  const [scanEnded, setScanEnded] = useState(false);
  const [paused, setPaused] = useState(false);

  // The scan: the playhead crosses the stream, and each pick lands as it's passed.
  useEffect(() => {
    if (!seen || reduce) return;
    const timers = PICKS.map((p, i) => setTimeout(() => setFound(i + 1), (p.at + p.len) * SCAN_MS));
    timers.push(setTimeout(() => setScanEnded(true), SCAN_MS));
    return () => timers.forEach(clearTimeout);
  }, [seen, reduce]);

  const scanning = seen && !reduce && !scanEnded;
  const done = reduce || found === PICKS.length;
  const shown = reduce ? PICKS.length : found;
  // Then the clips play their captions in turn (only while on screen and not paused).
  const tick = useTicker(WORD_MS, done && !reduce && !paused && visible);
  const total = STEPS.reduce((a, b) => a + b, 0) + PICKS.length * 3; // a short rest after each clip
  let t = tick % total;
  let playing = 0;
  while (t >= STEPS[playing]! + 3) {
    t -= STEPS[playing]! + 3;
    playing++;
  }

  return (
    <div className={styles.frame}>
      <figure ref={root} className={`studio ${styles.panel}`} aria-label="Example: Bamio finds three moments in a 1 hour 48 minute stream and turns each into a captioned vertical clip.">
        <div className={styles.source}>
          <div className={styles.wide} aria-hidden="true">
            <Scene />
            <span className={styles.chip}>
              <TwitchLogo size={14} weight="fill" /> Friday stream
            </span>
            <span className={styles.duration}>1:48:22</span>
          </div>
          <div className={styles.timeline} aria-hidden="true">
            <div className={styles.ruler}>
              <span>0:00</span>
              <span>0:36:00</span>
              <span>1:12:00</span>
              <span>1:48:22</span>
            </div>
            <div className={styles.track}>
              {PICKS.map((p, i) => (
                <span key={p.title} className={styles.range} data-on={i < shown ? "" : undefined} style={{ left: `${p.at * 100}%`, width: `${p.len * 100}%` }} />
              ))}
              <span className={styles.scan} data-scanning={scanning ? "" : undefined} data-done={done ? "" : undefined} style={{ ["--scan" as string]: `${SCAN_MS}ms` }}>
                <span className={styles.playhead} />
              </span>
            </div>
          </div>
          <div className={styles.status}>
            <p className={styles.found} data-on={shown > 0 ? "" : undefined} aria-hidden="true">
              <AiMark size={14} /> {shown === 0 ? "Looking for moments" : `Bamio found ${shown} ${shown === 1 ? "clip" : "clips"}`}
            </p>
            {!reduce ? (
              <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={paused ? "Play the example" : "Pause the example"} onClick={() => setPaused((v) => !v)}>
                {paused ? <Play size={16} weight="fill" aria-hidden /> : <Pause size={16} weight="fill" aria-hidden />}
              </button>
            ) : null}
          </div>
        </div>

        <span className={styles.arrow} aria-hidden="true">
          <ArrowRight size={20} weight="bold" />
        </span>

        <div className={styles.out}>
          <ol className={styles.clips} aria-hidden="true">
            {PICKS.map((p, i) => {
              const on = i < shown;
              const isPlaying = done && !reduce && i === playing;
              const words = p.lines.flat();
              const step = isPlaying ? Math.min(t, words.length - 1) : -1;
              const lineIndex = step < 0 ? 0 : step < p.lines[0]!.length ? 0 : 1;
              const inLine = step < 0 ? -1 : lineIndex === 0 ? step : step - p.lines[0]!.length;
              return (
                <li key={p.title} className={styles.clip} data-on={on ? "" : undefined} data-playing={isPlaying ? "" : undefined}>
                  <div className={styles.vertical}>
                    {p.framing === "fit" ? (
                      <div className={styles.fit}>
                        <div className={styles.fitBlur}>
                          <Scene />
                        </div>
                        <div className={styles.fitShot}>
                          <Scene />
                        </div>
                      </div>
                    ) : (
                      <SceneCrop focus={p.framing.focus} />
                    )}
                    <span className={styles.score}>
                      <AiMark size={11} /> {p.score}
                    </span>
                    <DemoCaption words={p.lines[lineIndex]!} active={inLine} captionStyle="pop" />
                  </div>
                  <p className={styles.title}>{p.title}</p>
                  <p className={styles.meta}>
                    {p.length} <span>9:16, 1080p</span>
                  </p>
                </li>
              );
            })}
          </ol>
          <p className={styles.platforms}>
            <TiktokLogo size={16} weight="fill" aria-hidden />
            <YoutubeLogo size={16} weight="fill" aria-hidden />
            <InstagramLogo size={16} weight="fill" aria-hidden />
            Ready for TikTok, Shorts and Reels
          </p>
        </div>
      </figure>
    </div>
  );
}
