"use client";

import { Pause, Play, SpeakerSimpleHigh, SpeakerSimpleSlash } from "@phosphor-icons/react";
import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useSourceVideo } from "@/hooks/use-source-video";
import { thumbUrl } from "@/lib/clips/api";
import { formatTimecode } from "@/lib/clips/logic";
import type { Clip } from "@/lib/clips/schema";
import styles from "./project.module.css";

export type PlayerHandle = {
  /** Play from `start` and stop at `end`. */
  playRange: (start: number, end: number) => void;
  seek: (t: number) => void;
  togglePlay: () => void;
  currentTime: () => number;
};

/**
 * The imported video with a scrubbable timeline. Clips show as blocks; the range
 * being marked shows as an outline. A followed stream plays as it grows.
 */
export function SourcePlayer({
  ref,
  projectId,
  following,
  durationSec,
  clips,
  mark,
  onPickClip,
}: {
  ref?: React.Ref<PlayerHandle>;
  projectId: string;
  following: boolean;
  durationSec: number;
  clips: Clip[];
  mark: { start: number | null; end: number | null };
  onPickClip: (clip: Clip) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const stopAt = useRef<number | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState(false);
  useSourceVideo(videoRef, projectId, following);

  const seek = useCallback(
    (t: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = Math.min(Math.max(0, t), durationSec);
      video.currentTime = next;
      setTime(next);
    },
    [durationSec],
  );

  useImperativeHandle(
    ref,
    () => ({
      playRange: (start, end) => {
        const video = videoRef.current;
        if (!video) return;
        stopAt.current = end;
        video.currentTime = start;
        setTime(start);
        void video.play().catch(() => undefined);
      },
      seek: (t) => {
        stopAt.current = null;
        seek(t);
      },
      togglePlay: () => {
        const video = videoRef.current;
        if (!video) return;
        stopAt.current = null;
        if (video.paused) void video.play().catch(() => undefined);
        else video.pause();
      },
      currentTime: () => videoRef.current?.currentTime ?? 0,
    }),
    [seek],
  );

  // While playing, follow the video closely (timeupdate alone is only ~4 per second).
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const loop = () => {
      const video = videoRef.current;
      if (video) {
        if (stopAt.current !== null && video.currentTime >= stopAt.current) {
          video.pause();
          stopAt.current = null;
        }
        setTime((prev) => (Math.abs(prev - video.currentTime) > 0.04 ? video.currentTime : prev));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing]);

  function seekFromPointer(e: React.PointerEvent) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    stopAt.current = null;
    seek(((e.clientX - rect.left) / rect.width) * durationSec);
  }

  const pct = (t: number) => `${(Math.min(Math.max(0, t), durationSec) / durationSec) * 100}%`;
  const hasMark = mark.start !== null || mark.end !== null;
  const markStart = mark.start ?? mark.end ?? 0;
  const markEnd = mark.end ?? mark.start ?? 0;

  return (
    <div className={styles.player}>
      <div className={styles.screen}>
        <video
          ref={videoRef}
          poster={thumbUrl(projectId)}
          preload="metadata"
          playsInline
          muted={muted}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onSeeked={(e) => setTime(e.currentTarget.currentTime)}
          onTimeUpdate={(e) => {
            if (!playing) setTime(e.currentTarget.currentTime);
          }}
          onError={() => setError(true)}
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            stopAt.current = null;
            if (video.paused) void video.play().catch(() => undefined);
            else video.pause();
          }}
        />
        {error ? <p className={styles.screenError}>This video can’t play in your browser. Clips can still be cut and exported.</p> : null}
      </div>

      <div className={styles.transport}>
        <button
          className="btn btn-volt btn-icon"
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            stopAt.current = null;
            if (video.paused) void video.play().catch(() => undefined);
            else video.pause();
          }}
        >
          {playing ? <Pause size={20} weight="fill" aria-hidden /> : <Play size={20} weight="fill" aria-hidden />}
        </button>
        <span className="timecode" aria-live="off">
          <b>{formatTimecode(time, { hundredths: true })}</b> / {formatTimecode(durationSec)}
        </span>
        <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => setMuted((m) => !m)}>
          {muted ? <SpeakerSimpleSlash size={18} aria-hidden /> : <SpeakerSimpleHigh size={18} aria-hidden />}
        </button>
      </div>

      <div className={styles.scrub}>
        <div
          ref={trackRef}
          className={styles.scrubTrack}
          role="slider"
          tabIndex={0}
          aria-label="Position in the video"
          aria-valuemin={0}
          aria-valuemax={Math.round(durationSec)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={formatTimecode(time)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            seekFromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 1;
            if (e.key === "ArrowRight") seek(time + step);
            else if (e.key === "ArrowLeft") seek(time - step);
            else if (e.key === "Home") seek(0);
            else if (e.key === "End") seek(durationSec);
            else return;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {clips.map((c) => (
            <span
              key={c.id}
              className={styles.scrubClip}
              style={{ left: pct(c.start), width: `max(3px, ${((c.end - c.start) / durationSec) * 100}%)` }}
              title={`${c.title} (${formatTimecode(c.start)} to ${formatTimecode(c.end)})`}
              onPointerDown={(e) => {
                e.stopPropagation();
                onPickClip(c);
              }}
            />
          ))}
          {hasMark ? <span className={styles.scrubMark} style={{ left: pct(Math.min(markStart, markEnd)), width: `max(2px, ${(Math.abs(markEnd - markStart) / durationSec) * 100}%)` }} /> : null}
          <span className={styles.scrubHead} style={{ left: pct(time) }} />
        </div>
      </div>
    </div>
  );
}
