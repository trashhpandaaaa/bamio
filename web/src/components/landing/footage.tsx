"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useInView, useReducedMotion } from "@/hooks/use-motion";
import styles from "./footage.module.css";

/*
 * Real footage for the landing page's demos: short silent loops of stock video from Mixkit
 * (Stock Video Free License: free for commercial use, no credit required; we credit it in the
 * footer). Made by scripts/encode-landing-footage.sh into public/landing/: a 960x540 loop as
 * WebM and MP4, stills of it at a few seconds in, and for the podcast a 10-frame filmstrip.
 *
 * A still shows until the footage is on screen and the page has finished loading (so a loop
 * never competes with the page's first picture); then the loop plays (from `at` seconds in).
 * With reduced motion, or data saving on, the stills stay.
 */

export type FootageName = "podcast" | "stream";

/** Where the people are, as a share of the frame's width (for 9:16 crops; the camera drifts a little, so these keep each face in all of the loop). */
export const FOCUS = {
  /** Two hosts at a desk: the man at the left edge, the woman at the right. */
  podcast: { left: 0.16, right: 0.84 },
  /** A streamer's face cam. */
  stream: { face: 0.53 },
} as const;

/** Seconds into each loop that have a still. */
const STILLS: Record<FootageName, readonly number[]> = { podcast: [0, 3, 6], stream: [0] };

const still = (name: FootageName, at: number) => `/landing/${name}-${STILLS[name].includes(at) ? at : 0}.webp`;

/** True once the page has loaded (its images included). */
const pageLoaded = {
  subscribe: (onChange: () => void) => {
    window.addEventListener("load", onChange);
    return () => window.removeEventListener("load", onChange);
  },
  get: () => document.readyState === "complete",
};

const saveData = {
  subscribe: () => () => undefined,
  get: () => Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData),
};

/**
 * The 16:9 shot, filling its parent (cropped to cover). `at`: where the loop starts (one of the
 * stills, so the still and the first frame match). `play`: false keeps the still. `priority`:
 * the page's main picture (the hero): its still loads first; other stills load as they come near.
 */
export function Footage({ name, at = 0, play = true, priority = false }: { name: FootageName; at?: number; play?: boolean; priority?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const visible = useInView(root, { threshold: 0.05 });
  const reduce = useReducedMotion();
  const lowData = useSyncExternalStore(saveData.subscribe, saveData.get, () => false);
  const loaded = useSyncExternalStore(pageLoaded.subscribe, pageLoaded.get, () => false);
  const [shown, setShown] = useState(false);
  const moving = play && visible && loaded && !reduce && !lowData;

  return (
    <div ref={root} className={styles.footage} aria-hidden="true">
      {/* A decorative frame of stock footage. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className={styles.media}
        src={still(name, at)}
        alt=""
        decoding={priority ? "sync" : "async"}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
      />
      {moving ? <Loop name={name} at={at} onShown={setShown} shown={shown} /> : null}
    </div>
  );
}

function Loop({ name, at, shown, onShown }: { name: FootageName; at: number; shown: boolean; onShown: (v: boolean) => void }) {
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    // Muted before playing, or browsers won't start it on their own.
    v.muted = true;
    v.defaultMuted = true;
    const start = () => {
      if (at > 0 && v.currentTime < at) v.currentTime = at;
      void v.play().catch(() => undefined);
    };
    if (v.readyState >= 1) start();
    else v.addEventListener("loadedmetadata", start, { once: true });
    return () => {
      v.removeEventListener("loadedmetadata", start);
      v.pause();
      onShown(false);
    };
  }, [at, onShown]);

  return (
    <video
      ref={video}
      className={styles.media}
      data-on={shown ? "" : undefined}
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      onPlaying={() => onShown(true)}
    >
      <source src={`/landing/${name}.webm`} type="video/webm" />
      <source src={`/landing/${name}.mp4`} type="video/mp4" />
    </video>
  );
}

/** A vertical (9:16) crop of the shot, centred on `focus` (0 = left edge, 1 = right edge), the way Bamio reframes a clip. Fills its parent, which should be 9:16. */
export function FootageCrop({ name, focus, at, play }: { name: FootageName; focus: number; at?: number; play?: boolean }) {
  // The crop is 81/256 of the frame's width: keep it inside the frame.
  const half = 81 / 512;
  const centre = Math.min(1 - half, Math.max(half, focus));
  return (
    <div className={styles.crop} aria-hidden="true">
      <div className={styles.cropInner} style={{ ["--focus" as string]: centre }}>
        <Footage name={name} at={at} play={play} />
      </div>
    </div>
  );
}

/** One frame of the podcast's filmstrip (0 to 9), centred and filling its parent (whatever its shape), like an editor's timeline. */
export function FilmstripFrame({ frame }: { frame: number }) {
  return <span className={styles.strip} style={{ ["--frame" as string]: frame }} aria-hidden="true" />;
}
