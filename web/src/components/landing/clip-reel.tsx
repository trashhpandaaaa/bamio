"use client";

import { useRef } from "react";
import { AiMark } from "@/components/brand";
import { useInView, useReducedMotion, useTicker } from "@/hooks/use-motion";
import { DemoCaption } from "./demo-caption";
import { Footage, type FootageName } from "./footage";
import styles from "./clip-reel.module.css";

/*
 * The clip reel: what hours of gameplay turn into. Six vertical clips of stock gaming footage
 * (Mixkit, scripts/landing-footage.mjs; no game anyone would recognise), each captioned word by
 * word in Bamio's "pop" style, with the title, score and length Bamio gives a clip. They're
 * examples, not real streams. Each plays only while it's on screen, after the page has loaded;
 * with reduced motion (or data saving) they stay stills, captions shown whole.
 */

type ReelClip = { footage: FootageName; title: string; score: number; length: string; source: string; words: string[] };

const CLIPS: ReelClip[] = [
  { footage: "reel-clutch", title: "The clutch nobody saw coming", score: 94, length: "0:41", source: "3 h 12 min stream", words: ["1v4", "and", "we", "won"] },
  { footage: "reel-shooter", title: "The skip that saves two minutes", score: 87, length: "0:47", source: "2 h 15 min stream", words: ["watch", "this", "wall", "right", "here"] },
  { footage: "reel-hype", title: "Chat called it before I did", score: 96, length: "0:34", source: "4 h 10 min stream", words: ["no", "way", "that", "worked"] },
  { footage: "reel-racer", title: "Last lap, no brakes", score: 91, length: "0:29", source: "2 h 48 min stream", words: ["no", "brakes", "all", "the", "way"] },
  { footage: "reel-rage", title: "How did that not hit?", score: 88, length: "0:22", source: "4 h 58 min stream", words: ["how", "did", "that", "not", "hit"] },
  { footage: "reel-vr", title: "Boss fight, but in VR", score: 90, length: "0:38", source: "1 h 56 min stream", words: ["dodge", "dodge", "and", "swing"] },
];

const WORD_MS = 420;
/** After the last word, the whole line stays for this many steps before it starts again. */
const HOLD = 3;

/** The row of clips: side by side on wide screens, a row to swipe (or scroll with the keyboard) on smaller ones. */
export function ClipReel() {
  return (
    // Focusable, so the row can be scrolled with the keyboard where it overflows.
    <ul className={styles.reel} tabIndex={0} aria-label="Example clips from gaming streams">
      {CLIPS.map((clip) => (
        <ReelCard key={clip.footage} clip={clip} />
      ))}
    </ul>
  );
}

function ReelCard({ clip }: { clip: ReelClip }) {
  const root = useRef<HTMLLIElement>(null);
  const reduce = useReducedMotion();
  const visible = useInView(root, { threshold: 0.4 });
  const tick = useTicker(WORD_MS, visible && !reduce);
  // Word by word while it's on screen; the finished line otherwise.
  const step = tick % (clip.words.length + HOLD);
  const active = reduce || !visible || step >= clip.words.length ? -1 : step;
  return (
    <li ref={root} className={styles.card}>
      <div className={styles.phone}>
        <Footage name={clip.footage} />
        <DemoCaption words={clip.words} active={active} captionStyle="pop" />
      </div>
      <div className={styles.meta}>
        <p className={styles.title}>{clip.title}</p>
        <p className={styles.facts}>
          <span className={styles.score} aria-label={`Score ${clip.score} of 100`}>
            <AiMark size={11} /> {clip.score}
          </span>
          <span>
            {clip.length} from a {clip.source}
          </span>
        </p>
      </div>
    </li>
  );
}
