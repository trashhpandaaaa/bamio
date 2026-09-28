"use client";

import { thumbUrl } from "@/lib/clips/api";
import { formatTimecode } from "@/lib/clips/logic";
import { LIMITS } from "@/lib/clips/schema";
import styles from "./editor.module.css";

const FRAMES = 10;

/**
 * The clip's in and out points over a filmstrip of the surrounding video.
 * Handles drag with the pointer or move with the arrow keys (Shift for 1 s steps).
 */
export function TrimBar({
  projectId,
  duration,
  view,
  start,
  end,
  time,
  onChange,
  onCommit,
  onSeek,
}: {
  projectId: string;
  duration: number;
  /** The stretch of the source shown on the bar. */
  view: { from: number; to: number };
  start: number;
  end: number;
  time: number;
  onChange: (start: number, end: number, edge: "start" | "end") => void;
  onCommit: () => void;
  onSeek: (t: number) => void;
}) {
  const span = Math.max(0.1, view.to - view.from);
  const pct = (t: number) => `${((Math.min(Math.max(t, view.from), view.to) - view.from) / span) * 100}%`;

  const clampStart = (s: number) => Math.min(Math.max(0, s, end - LIMITS.maxClipSec), end - LIMITS.minClipSec);
  const clampEnd = (e: number) => Math.max(Math.min(duration, e, start + LIMITS.maxClipSec), start + LIMITS.minClipSec);
  const round = (n: number) => Math.round(n * 100) / 100;

  /** Source time under the pointer, measured against the track element. */
  const timeAt = (clientX: number, track: Element | null) => {
    if (!track) return view.from;
    const rect = track.getBoundingClientRect();
    return view.from + ((clientX - rect.left) / rect.width) * span;
  };

  const handleProps = (edge: "start" | "end") => ({
    role: "slider",
    tabIndex: 0,
    "aria-label": edge === "start" ? "Clip start" : "Clip end",
    "aria-valuemin": 0,
    "aria-valuemax": Math.round(duration),
    "aria-valuenow": Math.round(edge === "start" ? start : end),
    "aria-valuetext": formatTimecode(edge === "start" ? start : end, { hundredths: true }),
    onPointerDown: (e: React.PointerEvent<HTMLSpanElement>) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<HTMLSpanElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const t = timeAt(e.clientX, e.currentTarget.parentElement);
      if (edge === "start") onChange(round(clampStart(t)), end, "start");
      else onChange(start, round(clampEnd(t)), "end");
    },
    onPointerUp: (e: React.PointerEvent<HTMLSpanElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
        onCommit();
      }
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLSpanElement>) => {
      const step = e.shiftKey ? 1 : 0.1;
      const dir = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      if (edge === "start") onChange(round(clampStart(start + dir * step)), end, "start");
      else onChange(start, round(clampEnd(end + dir * step)), "end");
    },
    onKeyUp: (e: React.KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) onCommit();
    },
  });

  const frames = Array.from({ length: FRAMES }, (_, i) => Math.round((view.from + ((i + 0.5) / FRAMES) * span) * 10) / 10);

  return (
    <div className={styles.trim}>
      <div
        className={styles.trimTrack}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          onSeek(Math.min(duration, Math.max(0, timeAt(e.clientX, e.currentTarget))));
        }}
      >
        <div className={styles.filmstrip} aria-hidden="true">
          {frames.map((t) => (
            // Frames come from our own API (cached per tenth of a second).
            // eslint-disable-next-line @next/next/no-img-element
            <img key={t} src={thumbUrl(projectId, Math.min(t, duration - 0.05))} alt="" loading="lazy" draggable={false} />
          ))}
        </div>
        <span className={styles.trimShade} style={{ left: 0, width: pct(start) }} />
        <span className={styles.trimShade} style={{ left: pct(end), right: 0 }} />
        <span className={styles.trimRange} style={{ left: pct(start), width: `calc(${pct(end)} - ${pct(start)})` }} />
        <span className={styles.trimHandle} data-edge="start" style={{ left: pct(start) }} {...handleProps("start")} />
        <span className={styles.trimHandle} data-edge="end" style={{ left: pct(end) }} {...handleProps("end")} />
        {time >= view.from && time <= view.to ? <span className={styles.trimHead} style={{ left: pct(time) }} /> : null}
      </div>
      <div className={styles.trimRuler} aria-hidden="true">
        <span>{formatTimecode(view.from)}</span>
        <span>{formatTimecode(view.to)}</span>
      </div>
    </div>
  );
}
