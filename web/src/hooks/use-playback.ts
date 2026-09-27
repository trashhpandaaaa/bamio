"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "@/lib/project/schema";
import { buildTimeline, isAudioCurrent, type Timeline } from "@/lib/project/timeline";
import { closeImages, loadImages, loadVoice, scheduleVoice, stopSources } from "@/lib/render/media";
import { canvasFontFamily, ensureCanvasFont, renderFrame } from "@/lib/render/renderer";

export const PREVIEW_SIZE = { width: 540, height: 960 } as const;

/** A key that changes only when the media the renderer needs changes. */
function mediaKeyOf(project: Project | null): string {
  if (!project) return "";
  return `${project.brief.voiceover}|${project.scenes
    .map((s) => `${s.id}:${s.imageId ?? ""}:${isAudioCurrent(s, project.style.voice) ? s.audioId : ""}`)
    .join(",")}`;
}

type Clock = { now: () => number; start: number; from: number };

/**
 * Drives a preview canvas: loads media, renders frames, and plays voice-over in sync.
 * While audio runs, the audio clock is the source of truth; otherwise performance.now().
 */
export function usePlayback(project: Project | null, options: { loop?: boolean; autoPlay?: boolean } = {}) {
  const { loop = false, autoPlay = false } = options;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const timeline: Timeline = useMemo(() => (project ? buildTimeline(project) : { items: [], total: 0 }), [project]);

  const images = useRef(new Map<string, ImageBitmap>());
  const voice = useRef(new Map<string, AudioBuffer>());
  const font = useRef("sans-serif");
  const audio = useRef<AudioContext | null>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const frame = useRef(0);
  const timeRef = useRef(0);
  const playingRef = useRef(false);
  const projectRef = useRef(project);
  const timelineRef = useRef(timeline);

  // Keep refs current for the animation loop. Declared first so later effects see fresh values.
  useEffect(() => {
    projectRef.current = project;
    timelineRef.current = timeline;
  });

  const draw = useCallback((t: number) => {
    const ctx = canvasRef.current?.getContext("2d");
    const p = projectRef.current;
    if (!ctx || !p) return;
    renderFrame(ctx, { project: p, timeline: timelineRef.current, assets: { images: images.current }, fontFamily: font.current }, t);
  }, []);

  const halt = useCallback(() => {
    cancelAnimationFrame(frame.current);
    stopSources(sources.current);
    sources.current = [];
  }, []);

  const pause = useCallback(() => {
    halt();
    playingRef.current = false;
    setPlaying(false);
  }, [halt]);

  const run = useCallback(
    (from: number) => {
      halt();
      const ctx = audio.current;
      const audioLive = ctx !== null && ctx.state === "running";
      const now = audioLive ? () => ctx.currentTime : () => performance.now() / 1000;
      const clock: Clock = { now, start: 0, from };
      const schedule = (start: number) => {
        clock.start = start;
        if (audioLive) sources.current = scheduleVoice(ctx, ctx.destination, timelineRef.current, voice.current, clock.from, start);
      };
      schedule(now() + (audioLive ? 0.05 : 0));
      const tick = () => {
        const total = timelineRef.current.total;
        const t = Math.min(total, clock.from + Math.max(0, clock.now() - clock.start));
        timeRef.current = t;
        setTime(t);
        draw(t);
        if (t >= total) {
          if (loop && total > 0) {
            stopSources(sources.current);
            clock.from = 0;
            schedule(clock.now());
            frame.current = requestAnimationFrame(tick);
            return;
          }
          halt();
          playingRef.current = false;
          setPlaying(false);
          return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [draw, halt, loop],
  );

  const play = useCallback(async () => {
    if (timelineRef.current.total <= 0) return;
    if (voice.current.size > 0) {
      try {
        audio.current ??= new AudioContext();
        await audio.current.resume();
      } catch {
        // No audio output available: play silently on the wall clock.
      }
    }
    const from = timeRef.current >= timelineRef.current.total - 0.05 ? 0 : timeRef.current;
    playingRef.current = true;
    setPlaying(true);
    run(from);
  }, [run]);

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(0, t), timelineRef.current.total);
      timeRef.current = clamped;
      setTime(clamped);
      if (playingRef.current) run(clamped);
      else draw(clamped);
    },
    [draw, run],
  );

  const toggle = useCallback(() => (playingRef.current ? pause() : void play()), [pause, play]);

  // (Re)load pictures and voice-over when the media changes.
  const mediaKey = mediaKeyOf(project);
  useEffect(() => {
    const p = projectRef.current ?? project;
    if (!p) return;
    let alive = true;
    const wasPlaying = playingRef.current;
    pause();
    const decoder = new OfflineAudioContext(1, 1, 44_100);
    const family = canvasFontFamily();
    Promise.all([loadImages(p), loadVoice(decoder, p), ensureCanvasFont(family)])
      .then(([imgs, buffers]) => {
        if (!alive) return closeImages(imgs);
        closeImages(images.current);
        images.current = imgs;
        voice.current = buffers;
        font.current = family;
      })
      .catch((err: unknown) => console.warn("[bamio] Preview media failed to load.", err))
      .finally(() => {
        if (!alive) return;
        setReady(true);
        draw(timeRef.current);
        if (autoPlay || wasPlaying) void play();
      });
    return () => {
      alive = false;
    };
    // `project` is read through projectRef; the effect should rerun only when media changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaKey, pause, draw, play, autoPlay]);

  // Redraw the paused frame after edits; clamp time if the video got shorter.
  useEffect(() => {
    if (playingRef.current) return;
    if (timeRef.current > timeline.total) timeRef.current = timeline.total;
    draw(timeRef.current);
  }, [draw, timeline, project, ready]);

  useEffect(
    () => () => {
      halt();
      closeImages(images.current);
      void audio.current?.close().catch(() => undefined);
      audio.current = null;
    },
    [halt],
  );

  return { canvasRef, time: Math.min(time, timeline.total), playing, ready, timeline, play, pause, toggle, seek };
}
