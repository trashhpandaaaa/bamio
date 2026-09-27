"use client";

import { Pause, Play } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";
import { usePlayback, PREVIEW_SIZE } from "@/hooks/use-playback";
import type { Project } from "@/lib/project/schema";
import styles from "./demo-player.module.css";

const scene = (id: string, caption: string, durationSec: number) => ({
  id,
  durationSec,
  caption,
  voiceover: "",
  visual: "",
  shot: "text-card" as const,
});

/** A real Bamio render (text cards + word-pop captions), used as the landing hero visual. */
const DEMO: Project = {
  id: "demo",
  version: 1,
  title: "Bamio demo",
  createdAt: 0,
  updatedAt: 0,
  brief: { idea: "Bamio demo", durationSec: 15, tone: "bold", voiceover: false },
  hooks: [],
  scenes: [
    scene("d1", "one sentence in.", 1.8),
    scene("d2", "three hooks out.", 1.8),
    scene("d3", "pick the one that stops you.", 2.4),
    scene("d4", "script, voice, captions. done.", 2.6),
    scene("d5", "make the first second count.", 2.8),
  ],
  style: { captionStyle: "pop", voice: "Puck", transition: "cut" },
  notes: [],
};

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (cb: () => void) => {
  const mq = window.matchMedia(motionQuery);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

export function DemoPlayer() {
  const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(motionQuery).matches, () => true);
  const { canvasRef, playing, toggle } = usePlayback(DEMO, { loop: true, autoPlay: !reduced });
  return (
    <div className={styles.frame}>
      <canvas
        ref={canvasRef}
        width={PREVIEW_SIZE.width}
        height={PREVIEW_SIZE.height}
        className={styles.canvas}
        role="img"
        aria-label="A sample Bamio video: bold captions pop in word by word on bright cards."
      />
      <button className={`btn btn-secondary btn-icon ${styles.control}`} type="button" onClick={toggle} aria-label={playing ? "Pause the sample video" : "Play the sample video"}>
        {playing ? <Pause size={18} weight="fill" aria-hidden /> : <Play size={18} weight="fill" aria-hidden />}
      </button>
    </div>
  );
}
