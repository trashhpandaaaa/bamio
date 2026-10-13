"use client";

import { ArrowCounterClockwise, ClosedCaptioning, Metronome, Snowflake, Stack, Stop, UserFocus } from "@phosphor-icons/react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { AUTO_LANGUAGE, LANGUAGE_OPTIONS } from "@/lib/clips/languages";
import { monoSamples } from "@/lib/editor/assets";
import { detectBeats, hasRoomForBeats, timelineBeats, cutToBeat } from "@/lib/editor/beats";
import { lineText, linesOf, retypeLine } from "@/lib/editor/captions";
import { canKey } from "@/lib/editor/chroma";
import { can } from "@/lib/editor/features";
import { applyLayout, CAM_CORNERS, camCrop, layoutOf, LAYOUTS, setCamCorner, type CamCorner, type LayoutId } from "@/lib/editor/layouts";
import {
  CAPTION_STYLE_IDS,
  CAPTION_STYLES,
  captionsOf,
  clock,
  EDITOR_LIMITS,
  FONT_IDS,
  FORMATS,
  GREEN_KEY,
  TEXT_ALIGNS,
  TEXT_COLORS,
  TEXT_FONTS,
  TRANSITION_IDS,
  TRANSITIONS,
  WHOLE,
  type AudioClip,
  type Captions,
  type ChromaKey,
  type Clip,
  type Media,
  type Overlay,
  type Rect,
  type TextLayer,
} from "@/lib/editor/model";
import { reframeTrack, visibleShare } from "@/lib/editor/reframe";
import { ReverseError, reverseVideo } from "@/lib/editor/reverse";
import { addOverlay, clipLength, freezeAt, layout, overlayLength, patchAudio, patchClip, patchOverlay, patchText, swapMedia } from "@/lib/editor/timeline";
import { CaptionError, makeCaptions } from "./auto-captions";
import { useEditor } from "./context";
import { ColorPick, Group, percent, secs, Slider, Switch } from "./controls";
import styles from "./editor.module.css";
import { editorFonts } from "./fonts";
import { PlanNote } from "./plan-note";
import { findFaces } from "./reframe-detect";

/*
 * The editor's newer tools, beside the basics in side-panel.tsx: transitions, freeze frames,
 * reverse, layouts, green screen and auto-reframe for clips; more control over text; layers;
 * captions; beats; loudness. What needs a plan asks `can` and shows a PlanNote when it can't.
 */

type Busy = { what: string; done: number; stop: AbortController };

/** Work that takes a while, with a way to stop it. Stopped when the panel goes. */
function useBusy() {
  const [busy, setBusy] = useState<Busy | null>(null);
  const running = useRef<Busy | null>(null);
  useEffect(() => () => running.current?.stop.abort(), []);
  return {
    busy,
    async run<T>(what: string, work: (signal: AbortSignal, progress: (done: number) => void) => Promise<T>): Promise<T | undefined> {
      if (running.current) return undefined;
      const stop = new AbortController();
      const entry = { what, done: 0, stop };
      running.current = entry;
      setBusy(entry);
      try {
        return await work(stop.signal, (done) => setBusy((b) => (b && b.stop === stop ? { ...b, done } : b)));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return undefined;
        throw err;
      } finally {
        running.current = null;
        setBusy(null);
      }
    },
  };
}

function BusyBar({ busy }: { busy: Busy }) {
  return (
    <div className={styles.busy} role="status">
      <span>
        {busy.what}… {Math.round(busy.done * 100)}%
      </span>
      <progress max={1} value={busy.done} aria-hidden />
      <button className="btn btn-ghost btn-sm" type="button" onClick={() => busy.stop.abort()}>
        <Stop size={14} weight="fill" aria-hidden /> Stop
      </button>
    </div>
  );
}

/* ------------------------------ Green screen ------------------------------ */

function KeyControls({ value, onChange }: { value: ChromaKey | undefined; onChange: (key: ChromaKey | undefined, stream?: string) => void }) {
  const { level } = useEditor();
  const allowed = can(level, "greenScreen");
  const works = useMemo(() => canKey(), []);
  return (
    <Group title="Green screen">
      <Switch label="Take out the green behind" checked={allowed && Boolean(value)} disabled={!allowed || !works} onChange={(on) => onChange(on ? GREEN_KEY : undefined)} />
      {!allowed ? <PlanNote feature="greenScreen" /> : null}
      {allowed && !works ? <p className="field-help">This browser can’t do green screen (it needs WebGL).</p> : null}
      {allowed && value ? (
        <>
          <ColorPick label="The colour to take out" value={value.color} onChange={(color) => onChange({ ...value, color }, "keyColor")} />
          <Slider label="How close counts" value={value.similarity} min={0.05} max={0.8} step={0.01} format={percent} onChange={(similarity) => onChange({ ...value, similarity }, "keySimilarity")} />
          <Slider label="Soft edge" value={value.smooth} min={0} max={0.5} step={0.01} format={percent} onChange={(smooth) => onChange({ ...value, smooth }, "keySmooth")} />
        </>
      ) : null}
    </Group>
  );
}

/* ------------------------------ Clips ------------------------------ */

/** A clip's newer tools: under its basics in the Edit tab. */
export function ClipFeatures({ clip }: { clip: Clip }) {
  const { edit, current, change, engine, assets, openFiles, level } = useEditor();
  const toast = useToast();
  const { busy, run } = useBusy();
  const media = edit.media.find((m) => m.id === clip.mediaId);
  const index = edit.clips.findIndex((c) => c.id === clip.id);
  const video = media?.kind === "video";
  const set = (patch: Partial<Clip>, key: string) => change(patchClip(edit, clip.id, patch), { key: `${key}:${clip.id}` });
  const length = clipLength(clip);
  const reversible = video && !clip.freeze && clip.end - clip.start <= EDITOR_LIMITS.maxReverseSec + 0.01;

  function freeze() {
    const placed = layout(edit).find((p) => p.clip.id === clip.id);
    if (!placed) return;
    const t = engine.time >= placed.from && engine.time < placed.to ? engine.time : placed.from;
    const made = freezeAt(edit, t);
    if (made.id) change(made.edit, { selection: { kind: "clip", id: made.id } });
    else toast({ tone: "error", title: "No room for a freeze frame", body: `An edit can have up to ${EDITOR_LIMITS.maxClips} clips.` });
  }

  async function reverse() {
    const asset = assets.get(clip.mediaId);
    if (!asset) return;
    try {
      await run("Reversing", async (signal, progress) => {
        engine.pause();
        const file = await reverseVideo(asset, clip.start, clip.end, progress, signal);
        const [opened] = await openFiles([file]);
        if (!opened) return;
        const now = current();
        if (!now.clips.some((c) => c.id === clip.id)) return;
        change(swapMedia(now, clip.id, opened.media));
        toast({ tone: "success", title: "Reversed", body: "The clip plays backwards now. Undo brings it back." });
      });
    } catch (err) {
      if (!(err instanceof ReverseError)) console.error("[bamio/editor] reversing failed:", err);
      toast({ tone: "error", title: "That clip couldn’t be reversed", body: err instanceof ReverseError ? err.message : "Try a shorter part, or another browser." });
    }
  }

  const mayReframe = can(level, "reframe");
  const box = clip.box ?? WHOLE;
  const frame = { width: FORMATS[edit.format].width * box.w, height: FORMATS[edit.format].height * box.h };
  const visible = media ? visibleShare(clip, media, frame) : { x: 1, y: 1 };
  const roomToMove = clip.fit === "fill" && (visible.x < 0.98 || visible.y < 0.98);

  async function follow() {
    const asset = assets.get(clip.mediaId);
    if (!asset) return;
    try {
      await run("Finding the face", async (signal, progress) => {
        const samples = await findFaces(asset, clip, progress, signal);
        const track = reframeTrack(samples, visible);
        const now = current();
        if (!now.clips.some((c) => c.id === clip.id)) return;
        if (track.length === 0) toast({ tone: "error", title: "No face found", body: "Auto-reframe follows a face; this clip doesn’t seem to have one. Drag the picture instead." });
        else change(patchClip(now, clip.id, { track }));
      });
    } catch {
      toast({ tone: "error", title: "Auto-reframe couldn’t start", body: "The face finder didn’t load. Check your connection and try again." });
    }
  }

  return (
    <>
      {index > 0 ? (
        <Group title="Transition in">
          <div className={styles.chips} role="group" aria-label="Transition in">
            <button className="chip" type="button" aria-pressed={!clip.transition} onClick={() => set({ transition: undefined }, "transition")}>
              None
            </button>
            {TRANSITION_IDS.map((kind) => (
              <button key={kind} className="chip" type="button" aria-pressed={clip.transition?.kind === kind} onClick={() => set({ transition: { kind, sec: Math.min(clip.transition?.sec ?? 0.5, Math.max(0.1, length)) } }, "transition")}>
                {TRANSITIONS[kind]}
              </button>
            ))}
          </div>
          {clip.transition ? (
            <Slider label="Length" value={clip.transition.sec} min={0.1} max={Math.max(0.1, Math.min(2, length))} step={0.05} format={secs} onChange={(sec) => set({ transition: { ...clip.transition!, sec } }, "transitionSec")} />
          ) : null}
          <p className="field-help">From the clip before into this one, over this clip’s first moments.</p>
        </Group>
      ) : null}
      {video && !clip.freeze ? (
        <Group title="Freeze and reverse">
          <div className={styles.actions}>
            <button className="btn btn-secondary btn-sm" type="button" onClick={freeze}>
              <Snowflake size={16} aria-hidden /> Freeze frame
            </button>
            <button className="btn btn-secondary btn-sm" type="button" disabled={!reversible || Boolean(busy)} onClick={() => void reverse()}>
              <ArrowCounterClockwise size={16} aria-hidden /> Reverse
            </button>
          </div>
          <p className="field-help">
            Freeze holds the frame at the playhead for {EDITOR_LIMITS.freezeSec} seconds. Reverse plays the clip backwards (up to {EDITOR_LIMITS.maxReverseSec} seconds; split a longer one first). It’s made on this device.
          </p>
        </Group>
      ) : null}
      {media?.kind !== "audio" ? <LayoutControls clip={clip} /> : null}
      {media ? <KeyControls value={clip.key} onChange={(key, stream) => set({ key }, stream ?? "key")} /> : null}
      {video && !clip.freeze ? (
        <Group title="Auto-reframe">
          {clip.track ? (
            <>
              <p className={styles.found}>The picture follows the face in this clip.</p>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => set({ track: undefined }, "track")}>
                Stop following
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" type="button" disabled={!mayReframe || !roomToMove || Boolean(busy)} onClick={() => void follow()}>
              <UserFocus size={16} aria-hidden /> Follow the face
            </button>
          )}
          {mayReframe ? null : <PlanNote feature="reframe" />}
          <p className="field-help">{roomToMove || clip.track ? "Keeps the speaker in the frame when a wide video fills a tall one. Faces are found on this device." : "The whole picture already shows: pick a taller shape, fill the frame or zoom in first."}</p>
        </Group>
      ) : null}
      {busy ? <BusyBar busy={busy} /> : null}
    </>
  );
}

/** Layouts: facecam on top, a split screen, a picture in the picture (Starter). */
function LayoutControls({ clip }: { clip: Clip }) {
  const { edit, current, change, openFiles, level } = useEditor();
  const toast = useToast();
  const allowed = can(level, "layouts");
  const [everyClip, setEveryClip] = useState(true);
  const [choosing, setChoosing] = useState<"split" | "pip" | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const kind = layoutOf(edit, clip);
  const targets = (e = edit) => (everyClip ? e.clips.filter((c) => c.mediaId === clip.mediaId).map((c) => c.id) : [clip.id]);
  const others = edit.media.filter((m) => m.id !== clip.mediaId && (m.kind === "video" || m.kind === "image"));

  function apply(id: LayoutId, other?: Media) {
    const now = current();
    const made = applyLayout(now, targets(now), id, other);
    change(made.edit, made.overlayId ? { selection: { kind: "overlay", id: made.overlayId } } : undefined);
    setChoosing(null);
  }

  function corner(c: CamCorner) {
    const now = current();
    change(setCamCorner(now, targets(now), c));
  }

  const shown = (c: CamCorner) => {
    const crop = camCrop(c);
    return Boolean(clip.cam && Math.abs(clip.cam.crop.x - crop.x) < 1e-3 && Math.abs(clip.cam.crop.y - crop.y) < 1e-3);
  };

  return (
    <Group title="Layout">
      <div className={styles.chips} role="group" aria-label="Layout">
        {(Object.keys(LAYOUTS) as LayoutId[]).map((id) => (
          <button
            key={id}
            className="chip"
            type="button"
            disabled={!allowed && id !== "full"}
            aria-pressed={choosing ? choosing === id : kind === id}
            onClick={() => (id === "split" || id === "pip" ? setChoosing(choosing === id ? null : id) : apply(id))}
          >
            {LAYOUTS[id]}
          </button>
        ))}
      </div>
      {allowed ? null : <PlanNote feature="layouts" />}
      {allowed && kind === "facecam" && !choosing ? (
        <div className="seg" role="group" aria-label="Where the camera is in the video">
          {(Object.keys(CAM_CORNERS) as CamCorner[]).map((c) => (
            <button key={c} type="button" aria-pressed={shown(c)} onClick={() => corner(c)}>
              {CAM_CORNERS[c]}
            </button>
          ))}
        </div>
      ) : null}
      {choosing ? (
        <div className={styles.choose}>
          <p className="field-help">{choosing === "split" ? "What goes in the bottom half?" : "What goes in the small picture?"}</p>
          <div className={styles.actions}>
            {others.map((m) => (
              <button key={m.id} className="btn btn-secondary btn-sm" type="button" onClick={() => apply(choosing, m)}>
                {m.name.length > 28 ? `${m.name.slice(0, 26)}…` : m.name}
              </button>
            ))}
            <button className="btn btn-primary btn-sm" type="button" onClick={() => input.current?.click()}>
              Another file
            </button>
          </div>
          <input
            ref={input}
            type="file"
            accept="video/*,image/*,.mov,.mkv"
            hidden
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])].slice(0, 1);
              e.target.value = "";
              const [opened] = await openFiles(files);
              if (opened && opened.media.kind !== "audio") apply(choosing, opened.media);
              else if (opened) toast({ tone: "error", title: "Pick a video or a photo", body: "A sound can’t be half the picture." });
            }}
          />
        </div>
      ) : null}
      {allowed ? <Switch label="Every clip from this video" checked={everyClip} onChange={setEveryClip} /> : null}
      <p className="field-help">Facecam on top puts the stream’s camera above the game, in step through every cut. Split screen and picture in picture lay another video or photo over these clips.</p>
    </Group>
  );
}

/* ------------------------------ Text ------------------------------ */

/** Typeface, alignment, colour of one's own, outline and shadow: under a text's basics. */
export function TextLook({ layer }: { layer: TextLayer }) {
  const { edit, change } = useEditor();
  const fonts = useMemo(() => editorFonts(), []);
  const set = (patch: Partial<TextLayer>, key: string) => change(patchText(edit, layer.id, patch), { key: `${key}:${layer.id}` });
  const boxed = layer.style === "box" || layer.style === "volt";
  const outline = layer.outline ?? (layer.style === "bold" ? 0.17 : 0);
  return (
    <>
      <Group title="Typeface">
        <div className={styles.chips} role="group" aria-label="Typeface">
          {FONT_IDS.map((font) => (
            <button key={font} className="chip" type="button" aria-pressed={(layer.font ?? "bricolage") === font} style={{ fontFamily: fonts[font]?.family }} onClick={() => set({ font }, "font")}>
              {TEXT_FONTS[font]}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Line up">
          {TEXT_ALIGNS.map((align) => (
            <button key={align} type="button" aria-pressed={(layer.align ?? "center") === align} onClick={() => set({ align }, "align")}>
              {align === "left" ? "Left" : align === "center" ? "Centre" : "Right"}
            </button>
          ))}
        </div>
        <ColorPick label={boxed ? "Another box colour" : "Another colour"} value={layer.color} onChange={(color) => set({ color }, "color")} />
      </Group>
      <Group title="Outline and shadow">
        <Slider label="Outline" value={outline} min={0} max={0.3} step={0.01} format={(v) => (v === 0 ? "None" : `${Math.round(v * 100)}`)} onChange={(v) => set({ outline: v }, "outline")} />
        {outline > 0 ? <ColorPick label="Outline colour" value={layer.outlineColor ?? "#000000"} onChange={(outlineColor) => set({ outlineColor }, "outlineColor")} /> : null}
        <Switch label="Shadow" checked={layer.shadow ?? !boxed} onChange={(shadow) => set({ shadow }, "shadow")} />
      </Group>
    </>
  );
}

/* ------------------------------ Layers ------------------------------ */

const PLACES: { name: string; place: (w: number, h: number) => Pick<Rect, "x" | "y"> }[] = [
  { name: "Top left", place: () => ({ x: 0.05, y: 0.05 }) },
  { name: "Top right", place: (w) => ({ x: 0.95 - w, y: 0.05 }) },
  { name: "Middle", place: (w, h) => ({ x: (1 - w) / 2, y: (1 - h) / 2 }) },
  { name: "Bottom left", place: (_w, h) => ({ x: 0.05, y: 0.95 - h }) },
  { name: "Bottom right", place: (w, h) => ({ x: 0.95 - w, y: 0.95 - h }) },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** A layer's settings (a logo, a facecam, the other half of a split screen). */
export function OverlaySettings({ overlay }: { overlay: Overlay }) {
  const { edit, change } = useEditor();
  const media = edit.media.find((m) => m.id === overlay.mediaId);
  const set = (patch: Partial<Overlay>, key: string) => change(patchOverlay(edit, overlay.id, patch), { key: `${key}:${overlay.id}` });
  const { box, crop } = overlay;
  const resize = (w: number) => {
    const k = w / box.w;
    const h = Math.min(1, Math.max(0.02, box.h * k));
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    set({ box: { w, h, x: clamp01(Math.min(1 - w, cx - w / 2)), y: clamp01(Math.min(1 - h, cy - h / 2)) } }, "size");
  };
  const cut = { left: crop.x, right: 1 - crop.x - crop.w, top: crop.y, bottom: 1 - crop.y - crop.h };
  const setCut = (side: keyof typeof cut, v: number) => {
    const next = { ...cut, [side]: v };
    const w = Math.max(0.1, 1 - next.left - next.right);
    const h = Math.max(0.1, 1 - next.top - next.bottom);
    set({ crop: { x: clamp01(Math.min(next.left, 1 - w)), y: clamp01(Math.min(next.top, 1 - h)), w, h } }, `crop-${side}`);
  };
  return (
    <>
      <p className={styles.itemName}>
        <Stack size={16} aria-hidden /> <span>{media?.name ?? "Layer"}</span> <small>{clock(overlayLength(overlay))}</small>
      </p>
      <Group title="Place">
        <div className={styles.chips} role="group" aria-label="Place">
          {PLACES.map(({ name, place }) => {
            const at = place(box.w, box.h);
            return (
              <button key={name} className="chip" type="button" aria-pressed={Math.abs(box.x - at.x) < 1e-3 && Math.abs(box.y - at.y) < 1e-3} onClick={() => set({ box: { ...box, x: clamp01(at.x), y: clamp01(at.y) } }, "place")}>
                {name}
              </button>
            );
          })}
          <button className="chip" type="button" aria-pressed={box.w === 1 && box.h === 1} onClick={() => set({ box: WHOLE }, "place")}>
            The whole frame
          </button>
        </div>
        <Slider label="Size" value={box.w} min={0.08} max={1} step={0.01} format={percent} onChange={resize} />
        <p className="field-help">Or drag it in the preview, and a corner to resize it.</p>
      </Group>
      <Group title="Look">
        <Slider label="Rounded corners" value={overlay.radius} min={0} max={0.5} step={0.01} format={(v) => (v >= 0.5 ? "Circle" : percent(v * 2))} onChange={(radius) => set({ radius }, "radius")} />
        <Slider label="See-through" value={1 - overlay.opacity} min={0} max={0.9} step={0.01} format={percent} onChange={(v) => set({ opacity: 1 - v }, "opacity")} />
        <Switch label="White border" checked={overlay.border} onChange={(border) => set({ border }, "border")} />
      </Group>
      <Group title="Crop">
        <Slider label="From the left" value={cut.left} min={0} max={0.45} step={0.01} format={percent} onChange={(v) => setCut("left", v)} />
        <Slider label="From the right" value={cut.right} min={0} max={0.45} step={0.01} format={percent} onChange={(v) => setCut("right", v)} />
        <Slider label="From the top" value={cut.top} min={0} max={0.45} step={0.01} format={percent} onChange={(v) => setCut("top", v)} />
        <Slider label="From the bottom" value={cut.bottom} min={0} max={0.45} step={0.01} format={percent} onChange={(v) => setCut("bottom", v)} />
      </Group>
      {media?.hasAudio ? (
        <Group title="Sound">
          <Switch label="Mute this layer" checked={overlay.muted} onChange={(muted) => set({ muted }, "mute")} />
          {overlay.muted ? null : <Slider label="Volume" value={overlay.volume} min={0} max={1} step={0.01} format={percent} onChange={(volume) => set({ volume }, "volume")} />}
        </Group>
      ) : null}
      <KeyControls value={overlay.key} onChange={(key, stream) => set({ key }, stream ?? "key")} />
    </>
  );
}

/** "Add as a layer" for a file in the Media tab: photos for everyone, videos with layouts. */
export function AddLayerButton({ media }: { media: Media }) {
  const { edit, change, engine, level } = useEditor();
  if (media.kind === "audio" || (media.kind === "video" && !can(level, "layouts"))) return null;
  return (
    <button
      className="btn btn-ghost btn-icon btn-sm"
      type="button"
      aria-label={`Add ${media.name} as a layer`}
      title="Add as a layer over the picture"
      onClick={() => {
        const added = addOverlay(edit, media, engine.time);
        if (added.id) change(added.edit, { selection: { kind: "overlay", id: added.id } });
      }}
    >
      <Stack size={16} aria-hidden />
    </button>
  );
}

/* ------------------------------ Captions ------------------------------ */

const CAPTION_PLACES = [
  ["Top", 0.2],
  ["Middle", 0.5],
  ["Lower third", 0.72],
] as const;

/** Captions: make them (Pro), style them and fix their words. In the Text tab. */
export function CaptionsGroup() {
  const { edit, current, change, engine, assets, level } = useEditor();
  const toast = useToast();
  const { busy, run } = useBusy();
  const [language, setLanguage] = useState<string>(AUTO_LANGUAGE);
  const id = useId();
  const fonts = useMemo(() => editorFonts(), []);
  const captions = edit.captions;
  const hasWords = Boolean(captions && Object.values(captions.words).some((w) => w.length > 0));
  const mayMake = can(level, "autoCaptions");
  const set = (patch: Partial<Captions>, key: string) => change({ ...edit, captions: { ...(edit.captions ?? captionsOf()), ...patch }, updatedAt: Date.now() }, { key: `captions-${key}` });

  async function make() {
    try {
      await run("Making captions", async (signal, progress) => {
        const made = await makeCaptions(current(), assets, language, (stage, done) => progress(stage === "reading" ? done * 0.15 : stage === "sending" ? 0.2 : 0.2 + done * 0.8), signal);
        if (!Object.values(made.words).some((w) => w.length > 0)) {
          toast({ tone: "error", title: "No words heard", body: "There doesn’t seem to be any speech in the parts this edit uses." });
          return;
        }
        const now = current();
        const kept = now.captions ?? captionsOf();
        change({ ...now, captions: { ...kept, on: true, words: { ...kept.words, ...made.words }, ...(made.language ? { language: made.language } : {}) }, updatedAt: Date.now() });
        toast({ tone: "success", title: "Captions made", body: "Restyle them here, and click a line to fix its words." });
      });
    } catch (err) {
      toast({ tone: "error", title: "The captions couldn’t be made", body: err instanceof CaptionError ? err.message : "Something went wrong. Try again." });
    }
  }

  /** Where a moment of a file first plays on the timeline (to jump to a line). */
  const seekTo = (mediaId: string, at: number) => {
    for (const p of layout(edit)) {
      if (p.clip.mediaId === mediaId && !p.clip.freeze && at >= p.clip.start && at < p.clip.end) return engine.seek(p.from + (at - p.clip.start) / p.clip.speed);
    }
  };

  return (
    <Group title="Captions">
      {hasWords && captions ? (
        <>
          <Switch label="Show captions" checked={captions.on} onChange={(on) => set({ on }, "on")} />
          <div className={styles.chips} role="group" aria-label="Caption style">
            {CAPTION_STYLE_IDS.map((style) => (
              <button key={style} className="chip" type="button" aria-pressed={captions.style === style} onClick={() => set({ style }, "style")}>
                {CAPTION_STYLES[style]}
              </button>
            ))}
          </div>
          <div className={styles.chips} role="group" aria-label="Caption typeface">
            {FONT_IDS.map((font) => (
              <button key={font} className="chip" type="button" aria-pressed={captions.font === font} style={{ fontFamily: fonts[font]?.family }} onClick={() => set({ font }, "font")}>
                {TEXT_FONTS[font]}
              </button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Where the captions are">
            {CAPTION_PLACES.map(([name, y]) => (
              <button key={name} type="button" aria-pressed={Math.abs(captions.y - y) < 1e-3} onClick={() => set({ y }, "y")}>
                {name}
              </button>
            ))}
          </div>
          <Slider label="Size" value={captions.size} min={0.5} max={2} step={0.05} format={percent} onChange={(size) => set({ size }, "size")} />
          <div className={styles.swatches} role="group" aria-label="Caption colour">
            {TEXT_COLORS.map((color) => (
              <button key={color.value} className={styles.swatch} type="button" aria-label={color.name} title={color.name} aria-pressed={captions.color.toUpperCase() === color.value.toUpperCase()} style={{ background: color.value }} onClick={() => set({ color: color.value }, "color")} />
            ))}
          </div>
          <ColorPick label="The word being said" value={captions.highlight} onChange={(highlight) => set({ highlight }, "highlight")} />
          <CaptionLines captions={captions} onSeek={seekTo} onChange={(mediaId, words) => change({ ...current(), captions: { ...captions, words: { ...captions.words, [mediaId]: words } }, updatedAt: Date.now() })} />
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => change({ ...edit, captions: undefined, updatedAt: Date.now() })}>
            Remove the captions
          </button>
        </>
      ) : null}
      <div className="field">
        <label className="field-label" htmlFor={`${id}-lang`}>
          Spoken language
        </label>
        <select id={`${id}-lang`} className="select" value={language} disabled={!mayMake || Boolean(busy)} onChange={(e) => setLanguage(e.target.value)}>
          <option value={AUTO_LANGUAGE}>Detect it</option>
          {LANGUAGE_OPTIONS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <button className="btn btn-secondary" type="button" disabled={!mayMake || Boolean(busy) || edit.clips.length === 0} onClick={() => void make()}>
        <ClosedCaptioning size={18} aria-hidden /> {hasWords ? "Make the captions again" : "Make captions"}
      </button>
      {busy ? <BusyBar busy={busy} /> : null}
      {mayMake ? null : <PlanNote feature="autoCaptions" />}
      <p className="field-help">
        Only the sound of the parts this edit uses is sent to Bamio, transcribed with a time for every word, and deleted. The picture stays on this device. It counts against your plan’s minutes.
      </p>
    </Group>
  );
}

const MAX_LINES_SHOWN = 400;

/** Every line of the captions, to fix by typing over it (Enter or leaving the box keeps it). */
function CaptionLines({ captions, onChange, onSeek }: { captions: Captions; onChange: (mediaId: string, words: Captions["words"][string]) => void; onSeek: (mediaId: string, at: number) => void }) {
  const lines = Object.entries(captions.words).flatMap(([mediaId, words]) => linesOf(words, captions.style).map((line) => ({ mediaId, words, line })));
  return (
    <details className={styles.captionLines}>
      <summary>Fix the words ({lines.length} lines)</summary>
      <ol>
        {lines.slice(0, MAX_LINES_SHOWN).map(({ mediaId, words, line }) => {
          const text = lineText(line.words);
          const commit = (value: string) => {
            if (value.trim() !== text) onChange(mediaId, retypeLine(words, line, value));
          };
          return (
            <li key={`${mediaId}-${line.start}-${text}`}>
              <small>{clock(line.start, false)}</small>
              <input
                className="input"
                defaultValue={text}
                aria-label={`Caption at ${clock(line.start, false)}`}
                maxLength={400}
                onFocus={() => onSeek(mediaId, line.start)}
                onBlur={(e) => commit(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  e.stopPropagation();
                }}
              />
            </li>
          );
        })}
      </ol>
      {lines.length > MAX_LINES_SHOWN ? <p className="field-help">The first {MAX_LINES_SHOWN} lines are shown.</p> : null}
    </details>
  );
}

/* ------------------------------ Sound ------------------------------ */

const BEAT_RATE = 11_025;
/** The most music listened to for its beat. */
const BEAT_MAX_SEC = 10 * 60;

/** Find a sound's beat, and put the clips' cuts on it (Pro). */
export function BeatControls({ sound }: { sound: AudioClip }) {
  const { edit, current, change, assets, level } = useEditor();
  const toast = useToast();
  const { busy, run } = useBusy();
  const allowed = can(level, "beats");
  const beats = timelineBeats(edit);

  async function find() {
    const asset = assets.get(sound.mediaId);
    if (!asset) return;
    await run("Listening for the beat", async (signal, progress) => {
      const end = Math.min(sound.end, sound.start + BEAT_MAX_SEC);
      const samples = await monoSamples(asset, sound.start, end, BEAT_RATE);
      if (signal.aborted) return;
      progress(0.8);
      const found = samples ? detectBeats(samples, BEAT_RATE) : { bpm: 0, beats: [] };
      if (found.beats.length === 0) {
        toast({ tone: "error", title: "No beat found", body: "This sound doesn’t have a steady beat to cut to." });
        return;
      }
      const now = current();
      change(patchAudio(now, sound.id, { beats: found.beats.map((b) => Math.round((sound.start + b) * 1000) / 1000).slice(0, 10_000) }));
      toast({ tone: "success", title: `${Math.round(found.bpm)} beats a minute`, body: "The beats are marked on the sound. Clips snap to them, or cut them all at once." });
    });
  }

  return (
    <Group title="Beat">
      <div className={styles.actions}>
        <button className="btn btn-secondary btn-sm" type="button" disabled={!allowed || !hasRoomForBeats(sound) || Boolean(busy)} onClick={() => void find()}>
          <Metronome size={16} aria-hidden /> {sound.beats?.length ? "Find the beat again" : "Find the beat"}
        </button>
        <button className="btn btn-secondary btn-sm" type="button" disabled={!allowed || beats.length === 0 || edit.clips.length === 0} onClick={() => change(cutToBeat(edit, beats), { selection: null })}>
          Cut to the beat
        </button>
      </div>
      {busy ? <BusyBar busy={busy} /> : null}
      {allowed ? null : <PlanNote feature="beats" />}
      <p className="field-help">Cut to the beat ends each clip on the beat nearest its end, so the cuts land with the music. Undo puts them back.</p>
    </Group>
  );
}

/* ------------------------------ Tools ------------------------------ */

/** Loudness levelling for the export (Starter). */
export function LevelGroup() {
  const { edit, change, level } = useEditor();
  const allowed = can(level, "level");
  return (
    <Group title="Loudness">
      <Switch label="Even out the loudness" checked={allowed && Boolean(edit.level)} disabled={!allowed} onChange={(on) => change({ ...edit, level: on, updatedAt: Date.now() })} />
      {allowed ? null : <PlanNote feature="level" />}
      <p className="field-help">The export comes out as loud as TikTok, Reels and Shorts play videos (−14 LUFS), with the peaks held under clipping. The preview plays as it is.</p>
    </Group>
  );
}
