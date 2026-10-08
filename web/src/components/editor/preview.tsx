"use client";

import { Camera, CaretLeft, CaretRight, FilmSlate, Pause, Play, Plus } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { textBoxAt } from "@/lib/editor/compose";
import { clock, FORMATS } from "@/lib/editor/model";
import { momentAt, patchClip, patchText, totalDuration } from "@/lib/editor/timeline";
import { useEditor, usePlaying } from "./context";
import styles from "./editor.module.css";

/** The preview draws at half the export's size: plenty for a screen, and light enough to play smoothly. */
const SCALE = 0.5;

/** The font the page's text uses, as a canvas wants it named. */
function pageFont(): string {
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-bricolage").trim();
  return family ? `${family}, system-ui, sans-serif` : "system-ui, sans-serif";
}

/**
 * The frame being edited, with play, step and snapshot under it. Text can be dragged where it
 * should sit, and the picture under it dragged when there's more of it than the frame shows.
 */
export function Preview({ opening }: { opening: number }) {
  const { edit, selection, change, select, engine, pickFiles } = useEditor();
  const playing = usePlaying(engine);
  const canvas = useRef<HTMLCanvasElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const size = FORMATS[edit.format];
  const total = totalDuration(edit);
  const empty = edit.clips.length === 0;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    el.width = Math.round(size.width * SCALE);
    el.height = Math.round(size.height * SCALE);
    const font = pageFont();
    engine.attach(el, font);
    // Text drawn before the font has loaded would be in another one.
    void document.fonts?.load(`800 40px ${font}`).then(() => engine.refresh());
    return () => engine.attach(null);
  }, [engine, size.width, size.height]);

  useEffect(() => {
    const show = () => {
      if (time.current) time.current.textContent = clock(engine.time);
    };
    show();
    return engine.subscribe(show);
  }, [engine]);

  /** Drag text to place it, or the picture to choose what the frame shows; a plain click plays or pauses. */
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const k = el.width / rect.width;
    const box = textBoxAt(engine.boxes, (e.clientX - rect.left) * k, (e.clientY - rect.top) * k);
    const layer = box ? edit.texts.find((t) => t.id === box.id) : undefined;
    const moment = momentAt(edit, engine.time);
    const clip = !layer && selection?.kind === "clip" && moment?.clip.id === selection.id ? moment.clip : undefined;
    if (layer) select({ kind: "text", id: layer.id });
    const start = { x: e.clientX, y: e.clientY };
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const onMove = (m: PointerEvent) => {
      const dx = (m.clientX - start.x) / rect.width;
      const dy = (m.clientY - start.y) / rect.height;
      if (!moved && Math.hypot(m.clientX - start.x, m.clientY - start.y) < 4) return;
      moved = true;
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      if (layer) change(patchText(edit, layer.id, { x: clamp(layer.x + dx, 0.02, 0.98), y: clamp(layer.y + dy, 0.02, 0.98) }), { key: `place:${layer.id}` });
      // Dragging the picture right shows more of its left: the position runs the other way. Twice the drag, so a full swipe crosses it.
      else if (clip) change(patchClip(edit, clip.id, { x: clamp(clip.x - dx * 2, -1, 1), y: clamp(clip.y - dy * 2, -1, 1) }), { key: `pan:${clip.id}` });
    };
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      if (!moved && !layer) engine.toggle();
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
  }

  /** Save the frame on screen as a picture, at the export's full size. */
  function snapshot() {
    const el = canvas.current;
    if (!el) return;
    engine.pause();
    const full = document.createElement("canvas");
    full.width = size.width;
    full.height = size.height;
    const selected = engine.selectedText;
    engine.selectText(null);
    engine.attach(full);
    // The engine draws on its next frame; then the canvas is handed back.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        full.toBlob((blob) => {
          engine.selectText(selected);
          engine.attach(el);
          if (!blob) return;
          const link = document.createElement("a");
          link.href = URL.createObjectURL(blob);
          link.download = `${edit.name || "frame"} ${clock(engine.time, false).replace(":", "-")}.png`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
        }, "image/png");
      }),
    );
  }

  return (
    <section className={styles.stage} aria-label="Preview">
      <div className={styles.frameBox}>
        <div className={styles.frame} style={{ "--ar": `${size.width / size.height}` } as React.CSSProperties}>
          <canvas ref={canvas} className={styles.canvas} role="img" aria-label={empty ? "Nothing in this edit yet" : `Preview of ${edit.name}`} onPointerDown={empty ? undefined : onPointerDown} />
          {empty ? (
            <div className={styles.emptyFrame}>
              <FilmSlate size={36} aria-hidden />
              <p>{opening > 0 ? "Opening your files…" : "Add a video or a photo to start."}</p>
              {opening > 0 ? null : (
                <button className="btn btn-primary btn-sm" type="button" onClick={() => pickFiles()}>
                  <Plus size={16} aria-hidden /> Add files
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
      <div className={styles.transport}>
        <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Back one frame" disabled={empty} onClick={() => engine.step(-1)}>
          <CaretLeft size={16} aria-hidden />
        </button>
        <button className={`btn btn-primary btn-icon ${styles.play}`} type="button" aria-label={playing ? "Pause" : "Play"} disabled={empty} onClick={() => engine.toggle()}>
          {playing ? <Pause size={20} weight="fill" aria-hidden /> : <Play size={20} weight="fill" aria-hidden />}
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Forward one frame" disabled={empty} onClick={() => engine.step(1)}>
          <CaretRight size={16} aria-hidden />
        </button>
        <p className={styles.clock}>
          <span ref={time}>0:00.0</span> / {clock(total)}
        </p>
        <button className={`btn btn-ghost btn-sm ${styles.snapshot}`} type="button" aria-label="Snapshot" disabled={empty} onClick={snapshot} title="Save this frame as a picture">
          <Camera size={16} aria-hidden /> <span className={styles.word}>Snapshot</span>
        </button>
      </div>
    </section>
  );
}
