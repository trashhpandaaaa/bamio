"use client";

import {
  ArrowsClockwise,
  ArrowsLeftRight,
  Copy,
  FilmStrip,
  Image as ImageIcon,
  Microphone,
  MusicNotes,
  Plus,
  Scissors,
  Stop,
  TextT,
  Trash,
  Waveform,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import {
  clock,
  EDITOR_LIMITS,
  FORMAT_IDS,
  FORMATS,
  LOOK_IDS,
  LOOKS,
  MOTIONS,
  TEXT_ANIMATION_IDS,
  TEXT_ANIMATIONS,
  TEXT_COLORS,
  TEXT_STYLE_IDS,
  TEXT_STYLES,
  VOLT,
  type AudioClip,
  type Clip,
  type Motion,
  type TextLayer,
} from "@/lib/editor/model";
import { SILENCE_PRESETS, silenceCuts, type SilencePreset } from "@/lib/editor/silence";
import { addMedia, addText, audioLength, clipLength, duplicateItem, patchAudio, patchClip, patchText, removeItem, rippleDelete, setSpeed, splitAt, totalDuration } from "@/lib/editor/timeline";
import { wavFrom } from "@/lib/editor/wav";
import { ACCEPT_SOUND, useEditor } from "./context";
import styles from "./editor.module.css";

const TABS = ["selected", "media", "text", "sound", "tools", "frame"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { selected: "Edit", media: "Media", text: "Text", sound: "Sound", tools: "Tools", frame: "Frame" };
const STICKERS = ["🔥", "😂", "👀", "💯", "❤️", "👇", "⭐", "🎉", "😮", "👏", "✅", "🚀"];
const BACKGROUNDS = [
  { value: "blur", name: "A blurred copy of the picture" },
  { value: "#000000", name: "Black" },
  { value: "#121212", name: "Ink" },
  { value: "#FFFFFF", name: "White" },
  { value: VOLT, name: "Volt" },
  { value: "#1E3A8A", name: "Blue" },
  { value: "#7F1D1D", name: "Red" },
] as const;
const SPEEDS = [0.5, 1, 1.5, 2];

/** A labelled slider. `format`: how its value reads. */
function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format?: (v: number) => string; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className={styles.sliderLabel} htmlFor={id}>
        <span>{label}</span>
        <output>{format ? format(value) : value}</output>
      </label>
      <input id={id} className={styles.range} type="range" min={min} max={max} step={step} value={value} aria-valuetext={format ? format(value) : undefined} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

const percent = (v: number) => `${Math.round(v * 100)}%`;
const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;
const secs = (v: number) => `${v.toFixed(1)} s`;

/** The tools beside the preview: what's selected, and things to add or change. */
export function SidePanel() {
  const { selection } = useEditor();
  const [tab, setTab] = useState<Tab>("media");
  const [seen, setSeen] = useState(selection);
  // Selecting something shows its settings ("Edit"); with nothing selected, that tab isn't offered.
  if (selection !== seen) {
    setSeen(selection);
    if (selection && selection.id !== seen?.id) setTab("selected");
  }
  const tabs = TABS.filter((t) => t !== "selected" || selection);
  const current = tab === "selected" && !selection ? "media" : tab;
  const id = useId();
  return (
    <aside className={styles.panel} aria-label="Tools">
      <div className={`tabs ${styles.tabs}`} role="tablist">
        {tabs.map((t) => (
          <button key={t} className="tab" type="button" role="tab" id={`${id}-${t}`} aria-selected={current === t} aria-controls={`${id}-panel`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div className={styles.panelBody} role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${current}`}>
        {current === "selected" ? <SelectedPanel /> : null}
        {current === "media" ? <MediaPanel /> : null}
        {current === "text" ? <TextPanel /> : null}
        {current === "sound" ? <SoundPanel /> : null}
        {current === "tools" ? <ToolsPanel /> : null}
        {current === "frame" ? <FramePanel /> : null}
      </div>
    </aside>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={styles.group}>
      <h3 className={styles.groupTitle}>{title}</h3>
      {children}
    </section>
  );
}

/* ------------------------------ Selected ------------------------------ */

function SelectedPanel() {
  const { edit, selection } = useEditor();
  if (selection?.kind === "clip") {
    const clip = edit.clips.find((c) => c.id === selection.id);
    return clip ? <ClipSettings clip={clip} /> : null;
  }
  if (selection?.kind === "text") {
    const layer = edit.texts.find((t) => t.id === selection.id);
    return layer ? <TextSettings layer={layer} /> : null;
  }
  if (selection?.kind === "audio") {
    const sound = edit.audio.find((a) => a.id === selection.id);
    return sound ? <SoundSettings sound={sound} /> : null;
  }
  return null;
}

function ItemActions() {
  const { edit, selection, change, engine } = useEditor();
  return (
    <div className={styles.actions}>
      <button
        className="btn btn-secondary btn-sm"
        type="button"
        onClick={() => {
          const cut = splitAt(edit, engine.time, selection);
          change(cut.edit, { selection: cut.selection });
        }}
      >
        <Scissors size={16} aria-hidden /> Split here
      </button>
      <button
        className="btn btn-secondary btn-sm"
        type="button"
        onClick={() => {
          const copy = duplicateItem(edit, selection);
          change(copy.edit, { selection: copy.selection });
        }}
      >
        <Copy size={16} aria-hidden /> Duplicate
      </button>
      <button className={`btn btn-ghost btn-sm ${styles.danger}`} type="button" onClick={() => change(removeItem(edit, selection), { selection: null })}>
        <Trash size={16} aria-hidden /> Delete
      </button>
    </div>
  );
}

function ClipSettings({ clip }: { clip: Clip }) {
  const { edit, change, engine } = useEditor();
  const media = edit.media.find((m) => m.id === clip.mediaId);
  const set = (patch: Partial<Clip>, key: string) => change(patchClip(edit, clip.id, patch), { key: `${key}:${clip.id}` });
  const still = media?.kind === "image";
  const adjusted = clip.brightness !== 0 || clip.contrast !== 0 || clip.saturation !== 0;
  return (
    <>
      <p className={styles.itemName}>
        {still ? <ImageIcon size={16} aria-hidden /> : <FilmStrip size={16} aria-hidden />} <span>{media?.name ?? "Clip"}</span> <small>{clock(clipLength(clip))}</small>
      </p>
      {still ? null : (
        <Group title="Speed">
          <div className="seg" role="group" aria-label="Speed">
            {SPEEDS.map((s) => (
              <button key={s} type="button" aria-pressed={clip.speed === s} onClick={() => change(setSpeed(edit, clip.id, s))}>
                {s}x
              </button>
            ))}
          </div>
          <Slider label="Any speed" value={clip.speed} min={EDITOR_LIMITS.minSpeed} max={EDITOR_LIMITS.maxSpeed} step={0.05} format={(v) => `${v.toFixed(2)}x`} onChange={(v) => change(setSpeed(edit, clip.id, v), { key: `speed:${clip.id}` })} />
          <p className="field-help">The sound’s pitch rises and falls with the speed.</p>
        </Group>
      )}
      {media?.hasAudio ? (
        <Group title="Sound">
          <label className={styles.switchRow}>
            <span>Mute this clip</span>
            <input className="switch" type="checkbox" role="switch" checked={clip.muted} onChange={(e) => set({ muted: e.target.checked }, "mute")} />
          </label>
          {clip.muted ? null : <Slider label="Volume" value={clip.volume} min={0} max={1} step={0.01} format={percent} onChange={(v) => set({ volume: v }, "volume")} />}
        </Group>
      ) : null}
      <Group title="Fades">
        <Slider label="Fade in" value={clip.fadeIn} min={0} max={3} step={0.1} format={secs} onChange={(v) => set({ fadeIn: v }, "fadeIn")} />
        <Slider label="Fade out" value={clip.fadeOut} min={0} max={3} step={0.1} format={secs} onChange={(v) => set({ fadeOut: v }, "fadeOut")} />
      </Group>
      <Group title="Framing">
        <div className="seg" role="group" aria-label="Framing">
          <button type="button" aria-pressed={clip.fit === "fill"} onClick={() => set({ fit: "fill" }, "fit")}>
            Fill the frame
          </button>
          <button type="button" aria-pressed={clip.fit === "fit"} onClick={() => set({ fit: "fit" }, "fit")}>
            Fit all of it
          </button>
        </div>
        <Slider label="Zoom" value={clip.zoom} min={1} max={4} step={0.01} format={(v) => `${v.toFixed(2)}x`} onChange={(v) => set({ zoom: v }, "zoom")} />
        <Slider label="Left to right" value={clip.x} min={-1} max={1} step={0.01} format={signed} onChange={(v) => set({ x: v }, "x")} />
        <Slider label="Top to bottom" value={clip.y} min={-1} max={1} step={0.01} format={signed} onChange={(v) => set({ y: v }, "y")} />
        <div className={styles.actions}>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => set({ rotate: ((clip.rotate + 90) % 360) as Clip["rotate"] }, "rotate")}>
            <ArrowsClockwise size={16} aria-hidden /> Turn
          </button>
          <button className="btn btn-secondary btn-sm" type="button" aria-pressed={clip.flip} onClick={() => set({ flip: !clip.flip }, "flip")}>
            <ArrowsLeftRight size={16} aria-hidden /> Flip
          </button>
        </div>
        <p className="field-help">Or drag the picture in the preview.</p>
      </Group>
      <Group title="Motion">
        <div className="seg" role="group" aria-label="Motion">
          {(Object.keys(MOTIONS) as Motion[]).map((m) => (
            <button key={m} type="button" aria-pressed={clip.motion === m} onClick={() => set({ motion: m }, "motion")}>
              {MOTIONS[m]}
            </button>
          ))}
        </div>
        <p className="field-help">A slow zoom across the clip.</p>
      </Group>
      <Group title="Look">
        {engine.filters ? (
          <>
            <div className={styles.chips} role="group" aria-label="Look">
              {LOOK_IDS.map((look) => (
                <button key={look} className="chip" type="button" aria-pressed={clip.look === look} onClick={() => set({ look }, "look")}>
                  {LOOKS[look].label}
                </button>
              ))}
            </div>
            <Slider label="Brightness" value={clip.brightness} min={-1} max={1} step={0.02} format={signed} onChange={(v) => set({ brightness: v }, "brightness")} />
            <Slider label="Contrast" value={clip.contrast} min={-1} max={1} step={0.02} format={signed} onChange={(v) => set({ contrast: v }, "contrast")} />
            <Slider label="Colour" value={clip.saturation} min={-1} max={1} step={0.02} format={signed} onChange={(v) => set({ saturation: v }, "saturation")} />
            {adjusted ? (
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => set({ brightness: 0, contrast: 0, saturation: 0 }, "reset")}>
                Reset the three
              </button>
            ) : null}
          </>
        ) : (
          <p className="field-help">Looks need a browser that can filter a canvas: Chrome, Edge or Firefox.</p>
        )}
      </Group>
      <ItemActions />
    </>
  );
}

function TextSettings({ layer }: { layer: TextLayer }) {
  const { edit, change } = useEditor();
  const id = useId();
  const set = (patch: Partial<TextLayer>, key: string) => change(patchText(edit, layer.id, patch), { key: `${key}:${layer.id}` });
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor={`${id}-text`}>
          Text
        </label>
        <textarea id={`${id}-text`} className={`textarea ${styles.textarea}`} rows={3} maxLength={EDITOR_LIMITS.maxText} value={layer.text} onChange={(e) => set({ text: e.target.value }, "text")} />
      </div>
      <Group title="Style">
        <div className={styles.chips} role="group" aria-label="Style">
          {TEXT_STYLE_IDS.map((style) => (
            <button
              key={style}
              className="chip"
              type="button"
              aria-pressed={layer.style === style}
              // Volt is a volt box unless another colour was picked; the others start white.
              onClick={() => set({ style, color: style === "volt" ? (layer.color === "#FFFFFF" ? VOLT : layer.color) : layer.style === "volt" && layer.color === VOLT ? "#FFFFFF" : layer.color }, "style")}
            >
              {TEXT_STYLES[style]}
            </button>
          ))}
        </div>
        <div className={styles.swatches} role="group" aria-label={layer.style === "volt" ? "Box colour" : "Text colour"}>
          {TEXT_COLORS.map((color) => (
            <button
              key={color.value}
              className={styles.swatch}
              type="button"
              aria-label={color.name}
              title={color.name}
              aria-pressed={layer.color.toUpperCase() === color.value.toUpperCase()}
              style={{ background: color.value }}
              onClick={() => set({ color: color.value }, "color")}
            />
          ))}
        </div>
        <Slider label="Size" value={layer.size} min={0.03} max={0.3} step={0.005} format={(v) => `${Math.round(v * 1000)}`} onChange={(v) => set({ size: v }, "size")} />
      </Group>
      <Group title="Movement">
        <div className={styles.chips} role="group" aria-label="Movement">
          {TEXT_ANIMATION_IDS.map((animation) => (
            <button key={animation} className="chip" type="button" aria-pressed={layer.animation === animation} onClick={() => set({ animation }, "animation")}>
              {TEXT_ANIMATIONS[animation]}
            </button>
          ))}
        </div>
      </Group>
      <Group title="Place">
        <div className="seg" role="group" aria-label="Place">
          {(
            [
              ["Top", 0.14],
              ["Middle", 0.5],
              ["Bottom", 0.8],
            ] as const
          ).map(([name, y]) => (
            <button key={name} type="button" aria-pressed={layer.x === 0.5 && layer.y === y} onClick={() => set({ x: 0.5, y }, "place")}>
              {name}
            </button>
          ))}
        </div>
        <p className="field-help">Or drag the text in the preview.</p>
        <Slider label="Shows for" value={Math.min(20, layer.duration)} min={0.3} max={20} step={0.1} format={secs} onChange={(v) => set({ duration: v }, "duration")} />
      </Group>
      <ItemActions />
    </>
  );
}

function SoundSettings({ sound }: { sound: AudioClip }) {
  const { edit, change } = useEditor();
  const media = edit.media.find((m) => m.id === sound.mediaId);
  const set = (patch: Partial<AudioClip>, key: string) => change(patchAudio(edit, sound.id, patch), { key: `${key}:${sound.id}` });
  return (
    <>
      <p className={styles.itemName}>
        <MusicNotes size={16} aria-hidden /> <span>{media?.name ?? "Sound"}</span> <small>{clock(audioLength(sound))}</small>
      </p>
      <Group title="Sound">
        <Slider label="Volume" value={sound.volume} min={0} max={1} step={0.01} format={percent} onChange={(v) => set({ volume: v }, "volume")} />
        <Slider label="Fade in" value={sound.fadeIn} min={0} max={5} step={0.1} format={secs} onChange={(v) => set({ fadeIn: v }, "fadeIn")} />
        <Slider label="Fade out" value={sound.fadeOut} min={0} max={5} step={0.1} format={secs} onChange={(v) => set({ fadeOut: v }, "fadeOut")} />
      </Group>
      <ItemActions />
    </>
  );
}

/* ------------------------------ Adding ------------------------------ */

function MediaPanel() {
  const { edit, change, engine, missing, pickFiles } = useEditor();
  return (
    <>
      <button className="btn btn-primary" type="button" onClick={() => pickFiles()}>
        <Plus size={18} aria-hidden /> Add videos, photos or sounds
      </button>
      <p className="field-help">Or drop files anywhere on this page. They stay on this device: nothing is uploaded.</p>
      {edit.media.length > 0 ? (
        <Group title="In this edit">
          <ul className={styles.media}>
            {edit.media.map((m) => (
              <li key={m.id}>
                {m.kind === "video" ? <FilmStrip size={16} aria-hidden /> : m.kind === "image" ? <ImageIcon size={16} aria-hidden /> : <MusicNotes size={16} aria-hidden />}
                <span className={styles.mediaName}>{m.name}</span>
                {missing.has(m.id) ? (
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => pickFiles({ replace: m.id })}>
                    Find it again
                  </button>
                ) : (
                  <>
                    <small>{m.kind === "image" ? "Photo" : clock(m.duration, false)}</small>
                    <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Add ${m.name} to the timeline again`} onClick={() => change(addMedia(edit, [m], engine.time))}>
                      <Plus size={16} aria-hidden />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          {missing.size > 0 ? <p className="field-help">This browser no longer has some files (it cleared its storage, or had no room). Pick them again and the edit carries on.</p> : null}
        </Group>
      ) : null}
    </>
  );
}

function TextPanel() {
  const { edit, change, engine } = useEditor();
  const add = (text: string | undefined, patch: Partial<TextLayer>) => {
    // Where the playhead is, or as late as still fits inside the edit: text past the end is never seen.
    const added = addText(edit, Math.max(0, Math.min(engine.time, totalDuration(edit) - EDITOR_LIMITS.textSec)), text);
    if (!added.id) return;
    change(patchText(added.edit, added.id, patch), { selection: { kind: "text", id: added.id } });
  };
  return (
    <>
      <button className="btn btn-primary" type="button" onClick={() => add(undefined, {})}>
        <TextT size={18} aria-hidden /> Add text
      </button>
      <p className="field-help">It appears at the playhead for {EDITOR_LIMITS.textSec} seconds. Drag it in the preview, stretch it on the timeline.</p>
      <Group title="Ready made">
        <div className={styles.actions}>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => add("Your title", { style: "volt", color: VOLT, y: 0.14, size: 0.075, animation: "rise" })}>
            Title
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => add("What’s being said", { style: "bold", y: 0.8, size: 0.07, animation: "pop" })}>
            Caption
          </button>
          <button className="btn btn-secondary btn-sm" type="button" onClick={() => add("Follow for more", { style: "box", y: 0.88, size: 0.05, animation: "type" })}>
            Call to action
          </button>
        </div>
      </Group>
      <Group title="Stickers">
        <div className={styles.stickers}>
          {STICKERS.map((s) => (
            <button key={s} className={styles.sticker} type="button" aria-label={`Add ${s}`} onClick={() => add(s, { style: "plain", size: 0.2, animation: "pop" })}>
              {s}
            </button>
          ))}
        </div>
      </Group>
    </>
  );
}

/** Record from the microphone while the edit plays, and put the recording at the moment it started. */
function Voiceover() {
  const { engine, addFiles } = useEditor();
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [quiet, setQuiet] = useState(true);
  const session = useRef<{ recorder: MediaRecorder; stream: MediaStream; at: number; timer: ReturnType<typeof setInterval> } | null>(null);
  useEffect(
    () => () => {
      const s = session.current;
      if (!s) return;
      clearInterval(s.timer);
      s.stream.getTracks().forEach((t) => t.stop());
      engine.setSilent(false);
    },
    [engine],
  );

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      toast({ tone: "error", title: "The microphone isn’t available", body: "Allow it for this site in the browser’s address bar, then try again." });
      return;
    }
    const recorder = new MediaRecorder(stream);
    const parts: Blob[] = [];
    const at = engine.time;
    recorder.ondataavailable = (e) => parts.push(e.data);
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        // Decoded and kept as a WAV: the recorder's own file can't be sought in.
        const context = new AudioContext();
        const decoded = await context.decodeAudioData(await new Blob(parts, { type: recorder.mimeType }).arrayBuffer());
        void context.close();
        // Back to where the recording started, with the voice there at full volume, selected.
        engine.seek(at);
        await addFiles([new File([wavFrom(decoded)], `Voiceover ${clock(at, false).replace(":", "-")}.wav`, { type: "audio/wav" })], { at, volume: 1, select: true });
      } catch {
        toast({ tone: "error", title: "The recording couldn’t be read", body: "Try again; a few seconds at least." });
      }
    };
    const started = Date.now();
    const timer = setInterval(() => setSeconds((Date.now() - started) / 1000), 250);
    session.current = { recorder, stream, at, timer };
    engine.setSilent(quiet);
    recorder.start();
    setSeconds(0);
    setRecording(true);
    engine.play();
  }

  function stop() {
    const s = session.current;
    if (!s) return;
    clearInterval(s.timer);
    session.current = null;
    engine.pause();
    engine.setSilent(false);
    s.recorder.stop();
    setRecording(false);
  }

  return (
    <Group title="Voiceover">
      {recording ? (
        <button className={`btn btn-primary ${styles.recording}`} type="button" onClick={stop}>
          <Stop size={18} weight="fill" aria-hidden /> Stop recording ({clock(seconds, false)})
        </button>
      ) : (
        <button className="btn btn-secondary" type="button" onClick={() => void start()}>
          <Microphone size={18} aria-hidden /> Record a voiceover
        </button>
      )}
      <label className={styles.switchRow}>
        <span>Silence the edit while recording</span>
        <input className="switch" type="checkbox" role="switch" checked={quiet} disabled={recording} onChange={(e) => setQuiet(e.target.checked)} />
      </label>
      <p className="field-help">Recording starts at the playhead and the edit plays along, so you can talk over the picture. With headphones on, switch the silence off.</p>
    </Group>
  );
}

function SoundPanel() {
  const { pickFiles } = useEditor();
  return (
    <>
      <button className="btn btn-primary" type="button" onClick={() => pickFiles({ accept: ACCEPT_SOUND })}>
        <MusicNotes size={18} aria-hidden /> Add music or a sound
      </button>
      <p className="field-help">It starts at the playhead. Use music you have the right to use: Bamio has no library of its own.</p>
      <Voiceover />
    </>
  );
}

/* ------------------------------ Tools ------------------------------ */

function Silences() {
  const { edit, change, assets, engine } = useEditor();
  const toast = useToast();
  const [preset, setPreset] = useState<SilencePreset>("normal");
  const envelopes = new Map([...assets].flatMap(([id, a]) => (a.envelope ? [[id, a.envelope] as const] : [])));
  const waiting = edit.clips.some((c) => assets.get(c.mediaId)?.audioTrack && !envelopes.has(c.mediaId));
  const found = silenceCuts(edit, envelopes, SILENCE_PRESETS[preset]);
  return (
    <Group title="Remove silences">
      <div className="seg" role="group" aria-label="How much to cut">
        {(Object.keys(SILENCE_PRESETS) as SilencePreset[]).map((p) => (
          <button key={p} type="button" aria-pressed={preset === p} onClick={() => setPreset(p)}>
            {SILENCE_PRESETS[p].label}
          </button>
        ))}
      </div>
      <p className={styles.found} role="status">
        {waiting ? "Listening to your video…" : found.ranges.length === 0 ? "No pauses to cut with this setting." : `${found.ranges.length} ${found.ranges.length === 1 ? "pause" : "pauses"}, ${found.seconds.toFixed(1)} seconds in all.`}
      </p>
      <button
        className="btn btn-secondary"
        type="button"
        disabled={waiting || found.ranges.length === 0}
        onClick={() => {
          engine.pause();
          change(rippleDelete(edit, found.ranges), { selection: null });
          engine.seek(0);
          toast({ tone: "success", title: `${found.ranges.length} ${found.ranges.length === 1 ? "pause" : "pauses"} cut out`, body: `The edit is ${found.seconds.toFixed(1)} seconds shorter. Undo brings them back.` });
        }}
      >
        <Waveform size={18} aria-hidden /> Cut them out
      </button>
      <p className="field-help">{SILENCE_PRESETS[preset].hint}. Text moves with the picture; music and voiceovers stay where they are.</p>
    </Group>
  );
}

function ToolsPanel() {
  const { edit, change } = useEditor();
  const set = (patch: Partial<typeof edit.progress>) => change({ ...edit, progress: { ...edit.progress, ...patch }, updatedAt: Date.now() }, { key: "progress" });
  return (
    <>
      <Silences />
      <Group title="Progress bar">
        <label className={styles.switchRow}>
          <span>A bar that fills as the video plays</span>
          <input className="switch" type="checkbox" role="switch" checked={edit.progress.on} onChange={(e) => set({ on: e.target.checked })} />
        </label>
        {edit.progress.on ? (
          <>
            <div className="seg" role="group" aria-label="Where the bar is">
              <button type="button" aria-pressed={!edit.progress.top} onClick={() => set({ top: false })}>
                Bottom
              </button>
              <button type="button" aria-pressed={edit.progress.top} onClick={() => set({ top: true })}>
                Top
              </button>
            </div>
            <div className={styles.swatches} role="group" aria-label="Bar colour">
              {TEXT_COLORS.map((color) => (
                <button
                  key={color.value}
                  className={styles.swatch}
                  type="button"
                  aria-label={color.name}
                  title={color.name}
                  aria-pressed={edit.progress.color.toUpperCase() === color.value.toUpperCase()}
                  style={{ background: color.value }}
                  onClick={() => set({ color: color.value })}
                />
              ))}
            </div>
          </>
        ) : null}
      </Group>
      <Group title="Keys">
        <dl className={styles.keys}>
          {[
            ["Space", "Play or pause"],
            ["S", "Split at the playhead"],
            ["Del", "Delete what’s selected"],
            ["← →", "One frame (Shift: one second)"],
            ["Home", "To the start (End: to the end)"],
            ["Ctrl Z", "Undo (Shift: redo)"],
            ["Ctrl D", "Duplicate"],
          ].map(([key, what]) => (
            <div key={key}>
              <dt>
                <span className="kbd">{key}</span>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </Group>
    </>
  );
}

function FramePanel() {
  const { edit, change } = useEditor();
  return (
    <>
      <Group title="Shape">
        <div className={styles.formats} role="group" aria-label="Shape">
          {FORMAT_IDS.map((f) => (
            <button key={f} className={styles.format} type="button" aria-pressed={edit.format === f} onClick={() => change({ ...edit, format: f, updatedAt: Date.now() })}>
              <span className={styles.formatShape} style={{ aspectRatio: `${FORMATS[f].width} / ${FORMATS[f].height}` }} aria-hidden />
              <b>{FORMATS[f].label}</b>
              <small>{FORMATS[f].name}</small>
            </button>
          ))}
        </div>
      </Group>
      <Group title="Behind the picture">
        <div className={styles.swatches} role="group" aria-label="Behind the picture">
          {BACKGROUNDS.map((b) => (
            <button
              key={b.value}
              className={styles.swatch}
              type="button"
              aria-label={b.name}
              title={b.name}
              aria-pressed={edit.background.toUpperCase() === b.value.toUpperCase()}
              data-blur={b.value === "blur" ? "" : undefined}
              style={b.value === "blur" ? undefined : { background: b.value }}
              onClick={() => change({ ...edit, background: b.value, updatedAt: Date.now() })}
            />
          ))}
        </div>
        <p className="field-help">Seen when a clip is set to “Fit all of it” and doesn’t fill the frame.</p>
      </Group>
    </>
  );
}
