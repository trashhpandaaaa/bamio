"use client";

import { Fragment, memo, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ASS_EM, ASS_OUTLINE, ASS_SIZES, captionMarginV, MARGIN_H, TITLE_TOP } from "@/lib/clips/ass";
import { sourceUrl, thumbUrl } from "@/lib/clips/api";
import { cropRect, joinWords, lineAt, OUTPUT_SIZE, titleLines, wordGap, type CaptionLine } from "@/lib/clips/logic";
import type { ClipEdit } from "@/lib/clips/schema";
import styles from "./editor.module.css";

export type PreviewHandle = {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Seek to a time in the source video. */
  seek: (t: number) => void;
  time: () => number;
};

type Props = {
  ref?: React.Ref<PreviewHandle>;
  projectId: string;
  srcW: number;
  srcH: number;
  start: number;
  end: number;
  edit: ClipEdit;
  lines: CaptionLine[];
  title: string;
  /** The transcript's language: picks the caption fonts (Chinese characters differ by language). */
  language?: string;
  onTime: (t: number) => void;
  onPlaying: (playing: boolean) => void;
  onFocusX: (focusX: number) => void;
};

/**
 * The clip as it will export: framed to the output aspect (crop with a focus point,
 * or fit over a blurred fill), with captions and title drawn like the ASS export.
 */
export function ClipPreview({ ref, projectId, srcW, srcH, start, end, edit, lines, title, language, onTime, onPlaying, onFocusX }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const range = useRef({ start, end });
  const drag = useRef<{ x: number; focusX: number; moved: boolean } | null>(null);
  const [t, setT] = useState(start);
  const [playing, setPlaying] = useState(false);
  // Fixed at the first start, so trimming doesn't request a new poster frame on every step.
  const [poster] = useState(() => thumbUrl(projectId, start));
  const { width: W, height: H } = OUTPUT_SIZE[edit.aspect];

  useEffect(() => {
    range.current = { start, end };
  }, [start, end]);

  useImperativeHandle(
    ref,
    () => ({
      play: () => {
        const v = videoRef.current;
        if (!v) return;
        if (v.currentTime < range.current.start || v.currentTime >= range.current.end - 0.05) v.currentTime = range.current.start;
        void v.play().catch(() => undefined);
      },
      pause: () => videoRef.current?.pause(),
      toggle: () => {
        const v = videoRef.current;
        if (!v) return;
        if (!v.paused) return v.pause();
        if (v.currentTime < range.current.start || v.currentTime >= range.current.end - 0.05) v.currentTime = range.current.start;
        void v.play().catch(() => undefined);
      },
      seek: (time) => {
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = time;
        setT(time);
        onTime(time);
      },
      time: () => videoRef.current?.currentTime ?? range.current.start,
    }),
    [onTime],
  );

  // Follow playback closely, loop inside the clip, and paint the blurred fill for "fit".
  useEffect(() => {
    let frame = 0;
    let last = -1;
    const loop = () => {
      const v = videoRef.current;
      if (v) {
        if (!v.paused && v.currentTime >= range.current.end) {
          v.currentTime = range.current.start;
        }
        if (Math.abs(v.currentTime - last) > 0.03) {
          last = v.currentTime;
          setT(v.currentTime);
          onTime(v.currentTime);
          paintFill(v, canvasRef.current);
        }
      }
      frame = requestAnimationFrame(loop);
    };
    if (playing) frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, onTime]);

  const r = cropRect(srcW || W, srcH || H, edit.aspect, edit.focusX);
  const canPan = edit.framing === "crop" && srcW > 0 && srcW - r.w > 2;
  const rel = t - start;
  const u = (n: number) => `calc(${n} * 100cqw / ${W})`;

  return (
    <div
      ref={frameRef}
      className={styles.frame}
      data-can-pan={canPan ? "" : undefined}
      style={{ aspectRatio: `${W} / ${H}`, "--arw": W, "--arh": H } as React.CSSProperties}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, focusX: edit.focusX, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const el = frameRef.current;
        if (!d || !el || !canPan) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 3) d.moved = true;
        // The part of the video hidden by the crop, in screen pixels.
        const hidden = (el.clientWidth * (srcW - r.w)) / r.w;
        if (d.moved && hidden > 0) onFocusX(Math.min(1, Math.max(0, d.focusX - dx / hidden)));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (d && !d.moved) {
          const v = videoRef.current;
          if (!v) return;
          if (!v.paused) v.pause();
          else {
            if (v.currentTime < range.current.start || v.currentTime >= range.current.end - 0.05) v.currentTime = range.current.start;
            void v.play().catch(() => undefined);
          }
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      {/* The export's fonts for every script (Bricolage for Latin, Noto for the rest), loaded as needed. */}
      <link rel="stylesheet" href={`/api/fonts/captions.css${language ? `?lang=${encodeURIComponent(language)}` : ""}`} precedence="default" />
      {edit.framing === "fit" ? <canvas ref={canvasRef} className={styles.fill} width={48} height={Math.round((48 * H) / W)} aria-hidden="true" /> : null}
      <video
        ref={videoRef}
        className={styles.video}
        src={sourceUrl(projectId)}
        poster={poster}
        preload="auto"
        playsInline
        style={{ objectFit: edit.framing === "fit" ? "contain" : "cover", objectPosition: `${edit.focusX * 100}% 50%` }}
        onLoadedMetadata={(e) => {
          e.currentTarget.currentTime = range.current.start;
        }}
        onSeeked={(e) => {
          setT(e.currentTarget.currentTime);
          onTime(e.currentTarget.currentTime);
          paintFill(e.currentTarget, canvasRef.current);
        }}
        onPlay={() => {
          setPlaying(true);
          onPlaying(true);
        }}
        onPause={() => {
          setPlaying(false);
          onPlaying(false);
        }}
      />

      {title ? (
        <p
          className={styles.titleOverlay}
          lang={language}
          dir="auto"
          style={{
            top: `${TITLE_TOP * 100}%`,
            left: `${MARGIN_H * 100}%`,
            right: `${MARGIN_H * 100}%`,
            fontSize: u(ASS_SIZES.title * ASS_EM),
          }}
        >
          <span style={{ padding: `${u(ASS_OUTLINE.title * 0.5)} ${u(ASS_OUTLINE.title)}` }}>
            {titleLines(title).map((l, i) => (
              <Fragment key={i}>
                {i > 0 ? <br /> : null}
                {l}
              </Fragment>
            ))}
          </span>
        </p>
      ) : null}

      {edit.captions ? <Captions lines={lines} t={rel} edit={edit} W={W} language={language} /> : null}

      {!playing ? <span className={styles.playHint} aria-hidden="true" /> : null}
    </div>
  );
}

/** Draw the current frame small; CSS blurs and scales it into the "fit" background. */
function paintFill(video: HTMLVideoElement, canvas: HTMLCanvasElement | null) {
  if (!canvas || video.readyState < 2) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cw = canvas.width;
  const ch = canvas.height;
  const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight);
  const w = video.videoWidth * scale;
  const h = video.videoHeight * scale;
  ctx.drawImage(video, (cw - w) / 2, (ch - h) / 2, w, h);
}

const Captions = memo(function Captions({ lines, t, edit, W, language }: { lines: CaptionLine[]; t: number; edit: ClipEdit; W: number; language?: string }) {
  const line = lineAt(lines, t);
  if (!line) return null;
  const style = edit.captionStyle;
  const u = (n: number) => `calc(${n} * 100cqw / ${W})`;
  const marginV = captionMarginV(edit.aspect, edit.captionPosition);
  const place: React.CSSProperties =
    edit.captionPosition === "middle" ? { top: "50%", transform: "translateY(-50%)" } : { bottom: `${(marginV * 100).toFixed(2)}%` };
  let active = -1;
  line.words.forEach((w, i) => {
    if (w.start <= t) active = i;
  });

  return (
    <p
      className={styles.caption}
      data-style={style}
      data-testid="caption"
      aria-hidden="true"
      lang={language}
      dir="auto"
      style={{
        ...place,
        left: `${MARGIN_H * 100}%`,
        right: `${MARGIN_H * 100}%`,
        fontSize: u(ASS_SIZES[style] * ASS_EM),
        ["--stroke" as string]: u(ASS_OUTLINE[style] * 2),
        ["--shadow" as string]: u(style === "clean" ? 3 : 2),
        ["--pad" as string]: u(ASS_OUTLINE.boxed),
      }}
    >
      {style === "pop" ? (
        line.words.map((w, i) => (
          <Fragment key={i}>
            <span className={i < active ? styles.wordPast : i === active ? styles.wordNow : styles.wordNext} data-active-word={i === active ? "" : undefined}>
              {w.text}
            </span>
            {i < line.words.length - 1 ? wordGap(w.text, line.words[i + 1]!.text) || null : null}
          </Fragment>
        ))
      ) : (
        <span className={styles.captionText}>{joinWords(line.words.map((w) => w.text))}</span>
      )}
    </p>
  );
});
