"use client";

import { Fragment, useRef } from "react";
import { AiMark } from "@/components/brand";
import { useInView, useReducedMotion } from "@/hooks/use-motion";
import { DemoCaption, DemoTitle } from "./demo-caption";
import { FOCUS, FootageCrop } from "./footage";
import styles from "./moment-finder.module.css";

/*
 * "AI that finds the moment, not just a clip": a stretch of transcript with the moment Bamio
 * picked marked on it (it starts on the hook and ends on the payoff, at a natural break),
 * where a fixed-length cut would have landed instead, and the clip it became.
 */

type Line = { at: string; text: string; role?: "hook" | "payoff" };

const LINES: Line[] = [
  { at: "18:02", text: "okay so it’s the final circle, three teams left" },
  { at: "18:06", text: "and I have literally no plates" },
  { at: "18:09", text: "wait for it.", role: "hook" },
  { at: "18:11", text: "I hear footsteps right behind me," },
  { at: "18:15", text: "no ammo, so I jump off the roof" },
  { at: "18:19", text: "and land right on top of him." },
  { at: "18:23", text: "nobody saw that coming.", role: "payoff" },
  { at: "18:26", text: "anyway chat, thanks for the subs" },
  { at: "18:30", text: "let’s queue up again" },
];
const START = LINES.findIndex((l) => l.role === "hook");
const END = LINES.findIndex((l) => l.role === "payoff");
/** Where a cut of a fixed length would end the clip: mid-sentence. */
const TIMED_CUT = 4;

export function MomentFinder() {
  const root = useRef<HTMLDivElement>(null);
  // Marks the moment when it first comes into view (at once with reduced motion).
  const seen = useInView(root, { once: true, threshold: 0.35 });
  const reduce = useReducedMotion();
  const found = seen || reduce;

  return (
    <div className={styles.frame}>
      <div ref={root} className={`studio ${styles.panel}`} data-found={found ? "" : undefined}>
        <figure className={styles.transcript} aria-label="A stretch of a stream's transcript, with the moment Bamio picked marked on it.">
          <ol className={styles.lines}>
            {LINES.map((l, i) => {
              const inside = i >= START && i <= END;
              const delay = { ["--i" as string]: Math.max(0, i - START) };
              return (
                <Fragment key={l.at}>
                  <li className={styles.line} data-inside={inside ? "" : undefined} data-role={l.role} style={delay}>
                    <span className={styles.time}>{l.at}</span>
                    <span className={styles.text}>{l.text}</span>
                    {l.role ? (
                      <span className={styles.tag}>
                        <AiMark size={11} /> {l.role === "hook" ? "Starts on the hook" : "Ends on the payoff"}
                      </span>
                    ) : null}
                  </li>
                  {i === TIMED_CUT ? (
                    <li className={styles.cut} data-inside="" style={delay}>
                      <span className={styles.long}>A fixed-length cut would end here, mid-sentence</span>
                    <span className={styles.short}>A fixed-length cut: mid-sentence</span>
                    </li>
                  ) : null}
                </Fragment>
              );
            })}
          </ol>
        </figure>

        <div className={styles.result}>
          <div className={styles.phone} aria-hidden="true">
            <FootageCrop name="stream" focus={FOCUS.stream.face} />
            <DemoTitle>the clutch nobody saw coming</DemoTitle>
            <DemoCaption words={["nobody", "saw", "that", "coming."]} active={-1} captionStyle="pop" />
          </div>
          <div className={styles.meta}>
            <p className={styles.title}>The clutch nobody saw coming</p>
            <p className={styles.facts}>
              <span className={styles.score}>
                <AiMark size={11} /> 94
              </span>
              <span>18:09 to 18:26</span>
              <span>0:17</span>
            </p>
            <p className={styles.why}>
              <AiMark size={12} />
              <span>
                <b>Picked by Bamio:</b> opens on a promise and pays it off 14 seconds later, with the reaction still in.
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
