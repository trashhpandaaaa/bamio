"use client";

import { ArrowsOutLineHorizontal, Copy, MagnifyingGlassMinus, MagnifyingGlassPlus, Scissors, SpeakerSimpleSlash, Trash } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { thumbAt, type Asset } from "@/lib/editor/assets";
import { clock, VOLT, type Edit, type Selection } from "@/lib/editor/model";
import {
  audioLength,
  clipLength,
  duplicateItem,
  layout,
  moveClip,
  moveOverlay,
  removeItem,
  rowsOf,
  snap,
  snapPoints,
  splitAt,
  totalDuration,
  trimClip,
  trimOverlay,
  type Placed,
} from "@/lib/editor/timeline";
import { useEditor } from "./context";
import styles from "./editor.module.css";

const MIN_ZOOM = 3;
const MAX_ZOOM = 320;
const TEXT_ROW = 30;
const SOUND_ROW = 40;
/** Seconds between the ruler's marks, by how much room a second has. */
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type View = { left: number; width: number };

/**
 * Pictures along a clip (and its sound's shape under them), or a sound's shape alone. Only
 * the part on screen is drawn: a long clip zoomed in is far wider than a canvas can be.
 */
function Strip({ asset, start, perSecond, width, height, view, offset, wave, drawn }: {
  asset: Asset | undefined;
  /** The file's second at the item's left edge, and how many of the file's seconds one pixel covers. */
  start: number;
  perSecond: number;
  width: number;
  height: number;
  view: View;
  /** The item's left edge on the timeline, in pixels. */
  offset: number;
  wave: "under" | "only";
  drawn: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const from = clamp(view.left - offset - 200, 0, width);
  const to = clamp(view.left + view.width - offset + 200, 0, width);
  const shown = Math.max(0, Math.round(to - from));
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !asset || shown === 0) return;
    canvas.width = shown;
    canvas.height = height;
    ctx.clearRect(0, 0, shown, height);
    /** The file's second under a pixel of the item. */
    const timeAt = (x: number) => start + x * perSecond;
    if (wave === "under") {
      const still = asset.bitmap;
      const sample = still ?? asset.thumbs[0]?.image;
      const ratio = sample ? (sample as { width: number }).width / (sample as { height: number }).height : 16 / 9;
      const tile = Math.max(24, Math.round(height * ratio));
      for (let x = Math.floor(from / tile) * tile; x < to; x += tile) {
        const image = still ?? thumbAt(asset.thumbs, timeAt(x + tile / 2))?.image;
        if (image) ctx.drawImage(image, x - from, 0, tile, height);
      }
    }
    const envelope = asset.envelope;
    if (!envelope) return;
    const band = wave === "only" ? height : Math.round(height * 0.3);
    const top = height - band;
    if (wave === "under") {
      ctx.fillStyle = "rgb(0 0 0 / 0.5)";
      ctx.fillRect(0, top, shown, band);
    }
    ctx.fillStyle = wave === "only" ? VOLT : "rgb(255 255 255 / 0.85)";
    for (let x = 0; x < shown; x += 2) {
      const a = Math.floor(timeAt(from + x) * envelope.rate);
      const b = Math.max(a + 1, Math.floor(timeAt(from + x + 2) * envelope.rate));
      let peak = 0;
      for (let i = Math.max(0, a); i < b && i < envelope.values.length; i++) peak = Math.max(peak, envelope.values[i] ?? 0);
      const h = Math.max(1, Math.min(1, peak * 1.6) * (band - 2));
      ctx.fillRect(x, top + (band - h) / 2, 1.4, h);
    }
  }, [asset, drawn, start, perSecond, from, to, shown, height, wave]);
  return <canvas ref={ref} className={styles.strip} style={{ left: from, width: shown, height }} aria-hidden />;
}

/** The two edges of what's selected, grabbed to trim it. */
function TrimHandles({ onTrim }: { onTrim: (e: React.PointerEvent, edge: "start" | "end") => void }) {
  return (
    <>
      <span className={styles.handle} data-edge="start" onPointerDown={(e) => onTrim(e, "start")} />
      <span className={styles.handle} data-edge="end" onPointerDown={(e) => onTrim(e, "end")} />
    </>
  );
}

/** The clips, text and sounds of the edit along time, with the playhead: where cutting, trimming and moving happen. */
export function Timeline() {
  const { edit, selection, change, select, engine, assets, missing, drawn } = useEditor();
  const scroller = useRef<HTMLDivElement>(null);
  const tracks = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [view, setView] = useState<View>({ left: 0, width: 800 });

  const total = totalDuration(edit);
  const placed = useMemo(() => layout(edit), [edit]);
  const textRows = useMemo(() => rowsOf(edit.texts.map((t) => ({ id: t.id, at: t.at, length: t.duration }))), [edit.texts]);
  const soundRows = useMemo(() => rowsOf(edit.audio.map((a) => ({ id: a.id, at: a.at, length: audioLength(a) }))), [edit.audio]);
  const end = Math.max(total, ...edit.texts.map((t) => t.at + t.duration), ...edit.audio.map((a) => a.at + audioLength(a)));
  // Fitted: the whole edit across the timeline's width.
  const fitted = end > 0 ? clamp((view.width - 64) / end, MIN_ZOOM, MAX_ZOOM) : 60;
  const pps = zoom ?? fitted;
  const width = Math.max(view.width, Math.ceil(end * pps) + 96);
  const step = STEPS.find((s) => s * pps >= 64) ?? STEPS[STEPS.length - 1]!;

  // What part of the timeline is on screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setView((v) => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth })));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, []);

  // The playhead follows the engine, and the timeline follows the playhead while it plays.
  useEffect(() => {
    const show = () => {
      const x = engine.time * pps;
      if (head.current) head.current.style.transform = `translateX(${x}px)`;
      const el = scroller.current;
      if (el && engine.playing && (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40)) el.scrollLeft = Math.max(0, x - 80);
    };
    show();
    return engine.subscribe(show);
  }, [engine, pps]);

  /** The timeline's second under a pointer. */
  const secondAt = (clientX: number) => Math.max(0, (clientX - (tracks.current?.getBoundingClientRect().left ?? 0)) / pps);

  /** Follow a pointer from where it went down until it's lifted. `onMove` gets the second under it and how far it has gone. */
  function drag(e: React.PointerEvent, onMove: (second: number, seconds: number, moved: boolean) => void, onEnd?: (moved: boolean) => void) {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startSecond = secondAt(startX);
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent) => {
      if (!moved && Math.abs(m.clientX - startX) < 4) return;
      moved = true;
      onMove(secondAt(m.clientX), secondAt(m.clientX) - startSecond, moved);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      onEnd?.(moved);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  }

  /** Moments to snap to while dragging `id`: the ends of everything else, and the playhead. Within 8 pixels. */
  const snapper = (base: Edit, id: string) => {
    const points = [...snapPoints(base, id), engine.time];
    return (second: number) => snap(second, points, 8 / pps);
  };

  function scrub(e: React.PointerEvent) {
    if (e.button !== 0) return;
    engine.pause();
    engine.seek(secondAt(e.clientX));
    drag(e, (second) => engine.seek(second));
  }

  /** Drag a clip's body: it changes places with its neighbours as it passes their middles. */
  function moveClipBy(e: React.PointerEvent, p: Placed) {
    e.stopPropagation();
    const selected: Selection = { kind: "clip", id: p.clip.id };
    select(selected);
    const base = edit;
    // Where the other clips' middles are with this one lifted out.
    let at = 0;
    const middles = base.clips.filter((c) => c.id !== p.clip.id).map((c) => {
      const middle = at + clipLength(c) / 2;
      at += clipLength(c);
      return middle;
    });
    const grab = secondAt(e.clientX) - p.from;
    drag(e, (second) => {
      const centre = second - grab + clipLength(p.clip) / 2;
      change(moveClip(base, p.clip.id, middles.filter((m) => m < centre).length), { key: `order:${p.clip.id}`, selection: selected });
    });
  }

  function trimClipBy(e: React.PointerEvent, p: Placed, edge: "start" | "end") {
    e.stopPropagation();
    const selected: Selection = { kind: "clip", id: p.clip.id };
    select(selected);
    const base = edit;
    const near = snapper(base, p.clip.id);
    // The right edge snaps where it is; the left edge stays put on the timeline, so there's nothing for it to snap to.
    drag(e, (second) => change(trimClip(base, p.clip.id, edge, edge === "end" ? near(second) : second), { key: `trim:${p.clip.id}:${edge}`, selection: selected }));
  }

  function moveOverlayBy(e: React.PointerEvent, selected: NonNullable<Selection>, at: number, length: number) {
    e.stopPropagation();
    select(selected);
    const base = edit;
    const near = snapper(base, selected.id);
    drag(e, (_second, seconds) => {
      // Whichever end lands on something snaps.
      const start = Math.max(0, at + seconds);
      const byStart = near(start);
      const byEnd = near(start + length) - length;
      const to = byStart !== start ? byStart : byEnd !== start ? byEnd : start;
      change(moveOverlay(base, selected, to), { key: `move:${selected.id}`, selection: selected });
    });
  }

  function trimOverlayBy(e: React.PointerEvent, selected: NonNullable<Selection>, edge: "start" | "end") {
    e.stopPropagation();
    select(selected);
    const base = edit;
    const near = snapper(base, selected.id);
    drag(e, (second) => change(trimOverlay(base, selected, edge, near(second)), { key: `trim:${selected.id}:${edge}`, selection: selected }));
  }

  const isSelected = (kind: NonNullable<Selection>["kind"], id: string) => selection?.kind === kind && selection.id === id;
  const onOptionKey = (selected: NonNullable<Selection>) => (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    select(selected);
  };

  const marks: number[] = [];
  for (let s = Math.max(0, Math.floor((view.left - 80) / pps / step) * step); s * pps < view.left + view.width + 80; s += step) marks.push(s);
  const textHeight = Math.max(1, Math.max(0, ...textRows.values()) + (edit.texts.length ? 1 : 0)) * TEXT_ROW;
  const soundHeight = Math.max(1, Math.max(0, ...soundRows.values()) + (edit.audio.length ? 1 : 0)) * SOUND_ROW;
  const nothing = !selection;

  return (
    <section className={styles.timeline} aria-label="Timeline">
      <div className={styles.tools}>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={total <= 0}
          aria-label="Split"
          title="Cut at the playhead (S)"
          onClick={() => {
            const cut = splitAt(edit, engine.time, selection);
            change(cut.edit, { selection: cut.selection });
          }}
        >
          <Scissors size={16} aria-hidden /> <span className={styles.word}>Split</span>
        </button>
        <button
          className="btn btn-ghost btn-sm"
          type="button"
          disabled={nothing}
          aria-label="Duplicate"
          title="Make a copy (Ctrl+D)"
          onClick={() => {
            const copy = duplicateItem(edit, selection);
            change(copy.edit, { selection: copy.selection });
          }}
        >
          <Copy size={16} aria-hidden /> <span className={styles.word}>Duplicate</span>
        </button>
        <button className="btn btn-ghost btn-sm" type="button" aria-label="Delete" disabled={nothing} title="Delete (Del)" onClick={() => change(removeItem(edit, selection), { selection: null })}>
          <Trash size={16} aria-hidden /> <span className={styles.word}>Delete</span>
        </button>
        <div className={styles.zoom} role="group" aria-label="Zoom">
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Zoom out" disabled={pps <= MIN_ZOOM} onClick={() => setZoom(clamp(pps / 1.6, MIN_ZOOM, MAX_ZOOM))}>
            <MagnifyingGlassMinus size={16} aria-hidden />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Fit the whole edit" aria-pressed={zoom === null} onClick={() => setZoom(null)}>
            <ArrowsOutLineHorizontal size={16} aria-hidden />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Zoom in" disabled={pps >= MAX_ZOOM} onClick={() => setZoom(clamp(pps * 1.6, MIN_ZOOM, MAX_ZOOM))}>
            <MagnifyingGlassPlus size={16} aria-hidden />
          </button>
        </div>
      </div>

      <div ref={scroller} className={styles.scroller} role="group" aria-label="Tracks" tabIndex={0}>
        <div ref={tracks} className={styles.tracks} style={{ width }}>
          <div className={styles.ruler} onPointerDown={scrub}>
            {marks.map((s) => (
              <span key={s} style={{ left: s * pps }}>
                {clock(s, step < 1)}
              </span>
            ))}
          </div>

          <div className={styles.rowClips} role={placed.length ? "listbox" : undefined} aria-label={placed.length ? "Clips" : undefined} onPointerDown={scrub}>
            {placed.length === 0 ? <p className={styles.rowHint}>Videos and photos play here, one after another.</p> : null}
            {placed.map((p) => {
              const asset = assets.get(p.clip.mediaId);
              const media = edit.media.find((m) => m.id === p.clip.mediaId);
              const w = (p.to - p.from) * pps;
              const selected = isSelected("clip", p.clip.id);
              return (
                <div
                  key={p.clip.id}
                  role="option"
                  tabIndex={0}
                  aria-selected={selected}
                  aria-label={`${media?.name ?? "Clip"}, ${clock(p.to - p.from)}`}
                  className={styles.clip}
                  data-selected={selected ? "" : undefined}
                  data-missing={missing.has(p.clip.mediaId) ? "" : undefined}
                  style={{ left: p.from * pps, width: w }}
                  onPointerDown={(e) => moveClipBy(e, p)}
                  onKeyDown={onOptionKey({ kind: "clip", id: p.clip.id })}
                >
                  <Strip asset={asset} start={p.clip.start} perSecond={p.clip.speed / pps} width={w} height={56} view={view} offset={p.from * pps} wave="under" drawn={drawn} />
                  <span className={styles.clipLabel}>
                    {p.clip.muted ? <SpeakerSimpleSlash size={12} aria-hidden /> : null}
                    {p.clip.speed !== 1 ? <b>{p.clip.speed}x</b> : null}
                    {missing.has(p.clip.mediaId) ? "Missing: " : ""}
                    {media?.name}
                  </span>
                  {selected ? <TrimHandles onTrim={(e, edge) => trimClipBy(e, p, edge)} /> : null}
                </div>
              );
            })}
          </div>

          <div className={styles.rowTexts} style={{ height: textHeight }} role={edit.texts.length ? "listbox" : undefined} aria-label={edit.texts.length ? "Text" : undefined} onPointerDown={scrub}>
            {edit.texts.length === 0 ? <p className={styles.rowHint}>Text</p> : null}
            {edit.texts.map((t) => {
              const selected = isSelected("text", t.id);
              const item: NonNullable<Selection> = { kind: "text", id: t.id };
              return (
                <div
                  key={t.id}
                  role="option"
                  tabIndex={0}
                  aria-selected={selected}
                  aria-label={`Text: ${t.text || "empty"}`}
                  className={styles.text}
                  data-selected={selected ? "" : undefined}
                  style={{ left: t.at * pps, width: Math.max(6, t.duration * pps), top: (textRows.get(t.id) ?? 0) * TEXT_ROW }}
                  onPointerDown={(e) => moveOverlayBy(e, item, t.at, t.duration)}
                  onKeyDown={onOptionKey(item)}
                >
                  <span>{t.text || "Text"}</span>
                  {selected ? <TrimHandles onTrim={(e, edge) => trimOverlayBy(e, item, edge)} /> : null}
                </div>
              );
            })}
          </div>

          <div className={styles.rowSounds} style={{ height: soundHeight }} role={edit.audio.length ? "listbox" : undefined} aria-label={edit.audio.length ? "Sounds" : undefined} onPointerDown={scrub}>
            {edit.audio.length === 0 ? <p className={styles.rowHint}>Music and voiceovers</p> : null}
            {edit.audio.map((a) => {
              const selected = isSelected("audio", a.id);
              const item: NonNullable<Selection> = { kind: "audio", id: a.id };
              const media = edit.media.find((m) => m.id === a.mediaId);
              const w = Math.max(6, audioLength(a) * pps);
              return (
                <div
                  key={a.id}
                  role="option"
                  tabIndex={0}
                  aria-selected={selected}
                  aria-label={`${media?.name ?? "Sound"}, ${clock(audioLength(a))}`}
                  className={styles.sound}
                  data-selected={selected ? "" : undefined}
                  data-missing={missing.has(a.mediaId) ? "" : undefined}
                  style={{ left: a.at * pps, width: w, top: (soundRows.get(a.id) ?? 0) * SOUND_ROW }}
                  onPointerDown={(e) => moveOverlayBy(e, item, a.at, audioLength(a))}
                  onKeyDown={onOptionKey(item)}
                >
                  <Strip asset={assets.get(a.mediaId)} start={a.start} perSecond={1 / pps} width={w} height={SOUND_ROW - 6} view={view} offset={a.at * pps} wave="only" drawn={drawn} />
                  <span className={styles.clipLabel}>{media?.name}</span>
                  {selected ? <TrimHandles onTrim={(e, edge) => trimOverlayBy(e, item, edge)} /> : null}
                </div>
              );
            })}
          </div>

          {/* Past the main track's end nothing is exported. */}
          <div className={styles.beyond} style={{ left: total * pps }} aria-hidden />
          <div ref={head} className={styles.playhead} aria-hidden />
        </div>
      </div>
    </section>
  );
}
