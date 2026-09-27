"use client";

import { CaretDown, Microphone, MusicNotes, Pause, Play, SkipBack, WarningCircle } from "@phosphor-icons/react";
import { useId, useRef, useState, type Dispatch } from "react";
import { useAssetUrl } from "@/hooks/use-asset-url";
import { PREVIEW_SIZE, usePlayback } from "@/hooks/use-playback";
import { sceneNeedsVoice } from "@/hooks/use-scene-media";
import type { ProjectAction } from "@/lib/project/ops";
import { CAPTION_STYLES, LIMITS, TRANSITIONS, VOICES, type CaptionStyle, type Project, type Scene, type Transition } from "@/lib/project/schema";
import { formatTimecode, isAudioCurrent, itemAt, type Timeline, type TimelineItem } from "@/lib/project/timeline";
import { cardColors } from "@/lib/render/renderer";
import styles from "./edit.module.css";
import { DurationField } from "./storyboard-panel";
import type { Media } from "./workspace";

const CAPTION_LABEL: Record<CaptionStyle, string> = { pop: "Pop", clean: "Clean", boxed: "Boxed" };
const TRANSITION_LABEL: Record<Transition, string> = { cut: "Cut", fade: "Fade" };

type Props = { project: Project; dispatch: Dispatch<ProjectAction>; media: Media };

export function EditPanel({ project, dispatch, media }: Props) {
  const { canvasRef, ready, playing, time, timeline, toggle, seek } = usePlayback(project);
  const [selectedId, setSelectedId] = useState<string | undefined>(project.scenes[0]?.id);
  const selectedIndex = Math.max(0, project.scenes.findIndex((s) => s.id === selectedId));
  const selected = project.scenes[selectedIndex];
  const voiceStale = project.scenes.filter((s) => sceneNeedsVoice(s, project)).length;
  const id = useId();

  const selectScene = (item: TimelineItem) => {
    setSelectedId(item.scene.id);
    seek(item.start);
  };

  return (
    <div
      className={`studio ${styles.studio}`}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement;
        if (e.key === " " && !target.closest("input, textarea, select, button, [role=slider]")) {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <div className={styles.stage}>
        <div className={styles.player}>
          <canvas
            ref={canvasRef}
            width={PREVIEW_SIZE.width}
            height={PREVIEW_SIZE.height}
            className={styles.canvas}
            role="img"
            aria-label={`Preview of “${project.title}”`}
          />
          {!ready ? <div className={`skeleton ${styles.loading}`} aria-label="Loading the preview" role="status" /> : null}
        </div>
        <div className={styles.transport}>
          <button className="btn btn-ghost btn-icon" type="button" aria-label="Back to start" onClick={() => seek(0)}>
            <SkipBack size={20} aria-hidden />
          </button>
          <button className={`btn btn-volt ${styles.play}`} type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle} disabled={timeline.total <= 0}>
            {playing ? <Pause size={22} weight="fill" aria-hidden /> : <Play size={22} weight="fill" aria-hidden />}
          </button>
          <span className="timecode" aria-live="off">
            <b>{formatTimecode(time)}</b> / {formatTimecode(timeline.total)}
          </span>
        </div>
      </div>

      <TimelineView project={project} timeline={timeline} time={time} selectedId={selected?.id} onSeek={seek} onSelect={selectScene} />

      <aside className={styles.inspector} aria-label="Inspector">
        {selected ? (
          <section className={styles.group} aria-labelledby={`${id}-scene`}>
            <h3 id={`${id}-scene`} className={styles.groupTitle}>
              Scene {selectedIndex + 1}
            </h3>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-cap`}>
                On-screen caption
              </label>
              <input
                id={`${id}-cap`}
                className="input"
                type="text"
                name="caption"
                autoComplete="off"
                maxLength={LIMITS.caption}
                value={selected.caption}
                onChange={(e) => dispatch({ type: "updateScene", id: selected.id, patch: { caption: e.target.value } })}
              />
            </div>
            <DurationField
              key={selected.id}
              id={`${id}-dur`}
              value={selected.durationSec}
              onCommit={(durationSec) => dispatch({ type: "updateScene", id: selected.id, patch: { durationSec } })}
            />
          </section>
        ) : null}

        <section className={styles.group} aria-labelledby={`${id}-look`}>
          <h3 id={`${id}-look`} className={styles.groupTitle}>
            Look
          </h3>
          <div className="field">
            <span className="field-label" id={`${id}-capstyle`}>
              Captions
            </span>
            <div className="seg" role="group" aria-labelledby={`${id}-capstyle`}>
              {CAPTION_STYLES.map((c) => (
                <button key={c} type="button" aria-pressed={project.style.captionStyle === c} onClick={() => dispatch({ type: "setStyle", patch: { captionStyle: c } })}>
                  {CAPTION_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="field-label" id={`${id}-trans`}>
              Between scenes
            </span>
            <div className="seg" role="group" aria-labelledby={`${id}-trans`}>
              {TRANSITIONS.map((t) => (
                <button key={t} type="button" aria-pressed={project.style.transition === t} onClick={() => dispatch({ type: "setStyle", patch: { transition: t } })}>
                  {TRANSITION_LABEL[t]}
                </button>
              ))}
            </div>
          </div>
          {project.brief.voiceover ? (
            <div className="field">
              <label className="field-label" htmlFor={`${id}-voice`}>
                Voice
              </label>
              <div className="select-wrap">
                <select
                  id={`${id}-voice`}
                  className="select"
                  name="voice"
                  value={project.style.voice}
                  onChange={(e) => dispatch({ type: "setStyle", patch: { voice: e.target.value as Project["style"]["voice"] } })}
                >
                  {VOICES.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}, {v.label.toLowerCase()}
                    </option>
                  ))}
                </select>
                <CaretDown size={16} aria-hidden />
              </div>
            </div>
          ) : null}
          {voiceStale > 0 ? (
            <div className="notice is-warning">
              <WarningCircle size={18} aria-hidden />
              <div className={styles.noticeBody}>
                <p>
                  {voiceStale} {voiceStale === 1 ? "scene needs" : "scenes need"} a new voice-over recording.
                </p>
                <button className="btn btn-secondary btn-sm" type="button" disabled={media.busy.size > 0} aria-busy={media.busy.size > 0} onClick={() => void media.generateAllVoice()}>
                  {media.busy.size > 0 ? null : <Microphone size={16} aria-hidden />}
                  {media.busy.size > 0 ? "Recording…" : "Record now"}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </aside>

    </div>
  );
}

function tickStep(total: number): number {
  if (total <= 12) return 1;
  if (total <= 30) return 2;
  if (total <= 60) return 5;
  return 10;
}

function TimelineView({
  project,
  timeline,
  time,
  selectedId,
  onSeek,
  onSelect,
}: {
  project: Project;
  timeline: Timeline;
  time: number;
  selectedId: string | undefined;
  onSeek: (t: number) => void;
  onSelect: (item: TimelineItem) => void;
}) {
  const scrubRef = useRef<HTMLDivElement>(null);
  const total = timeline.total;
  const pct = (t: number) => `${total > 0 ? (t / total) * 100 : 0}%`;
  const step = tickStep(total);
  const ticks = total > 0 ? Array.from({ length: Math.floor(total / step) + 1 }, (_, i) => i * step) : [];
  const current = itemAt(timeline, time);

  const seekFromPointer = (clientX: number) => {
    const rect = scrubRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onSeek(((clientX - rect.left) / rect.width) * total);
  };

  return (
    <div className={styles.timeline}>
      <div
        ref={scrubRef}
        className={styles.scrub}
        role="slider"
        tabIndex={0}
        aria-label="Playhead position"
        aria-valuemin={0}
        aria-valuemax={Math.round(total * 100) / 100}
        aria-valuenow={Math.round(time * 100) / 100}
        aria-valuetext={`${formatTimecode(time)}${current ? `, scene ${current.index + 1}` : ""}`}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          seekFromPointer(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e.clientX);
        }}
        onKeyDown={(e) => {
          const delta = e.key === "ArrowRight" ? 0.5 : e.key === "ArrowLeft" ? -0.5 : 0;
          if (delta) {
            e.preventDefault();
            onSeek(time + (e.shiftKey ? delta * 4 : delta));
          } else if (e.key === "Home") {
            e.preventDefault();
            onSeek(0);
          } else if (e.key === "End") {
            e.preventDefault();
            onSeek(total);
          }
        }}
      >
        {ticks.map((t) => (
          <span key={t} className={styles.tick} style={{ left: pct(t) }}>
            {Math.floor(t / 60)}:{String(Math.floor(t % 60)).padStart(2, "0")}
          </span>
        ))}
      </div>

      <div className={styles.tracks}>
        <div className="track" role="group" aria-label="Scenes">
          {timeline.items.map((item) => (
            <VideoClip key={item.scene.id} item={item} left={pct(item.start)} width={pct(item.duration)} selected={item.scene.id === selectedId} onSelect={() => onSelect(item)} />
          ))}
        </div>
        <div className="track track-sm" role="group" aria-label="Captions">
          {timeline.items
            .filter((item) => item.scene.caption.trim())
            .map((item) => (
              <button
                key={item.scene.id}
                type="button"
                className="clip clip-caption"
                style={{ ["--x" as string]: pct(item.start), ["--w" as string]: pct(item.duration) }}
                onClick={() => onSelect(item)}
                aria-label={`Caption, scene ${item.index + 1}: ${item.scene.caption}`}
              >
                {item.scene.caption}
              </button>
            ))}
        </div>
        {project.brief.voiceover ? (
          <div className="track track-sm" role="group" aria-label="Voice-over">
            {timeline.items
              .filter((item) => isAudioCurrent(item.scene, project.style.voice) && item.scene.audioDurationSec)
              .map((item) => (
                <button
                  key={item.scene.id}
                  type="button"
                  className="clip clip-audio"
                  style={{ ["--x" as string]: pct(item.start), ["--w" as string]: pct(Math.min(item.duration, item.scene.audioDurationSec ?? 0)) }}
                  onClick={() => onSelect(item)}
                  aria-label={`Voice-over, scene ${item.index + 1}`}
                >
                  <MusicNotes size={14} aria-hidden />
                  {item.scene.voiceover}
                </button>
              ))}
          </div>
        ) : null}
        <span className="playhead" style={{ ["--x" as string]: pct(time) }} aria-hidden="true" />
      </div>
    </div>
  );
}

function VideoClip({ item, left, width, selected, onSelect }: { item: TimelineItem; left: string; width: string; selected: boolean; onSelect: () => void }) {
  const scene: Scene = item.scene;
  const url = useAssetUrl(scene.shot === "text-card" ? undefined : scene.imageId);
  const card = cardColors(item.index);
  return (
    <button
      type="button"
      className="clip clip-video"
      aria-pressed={selected}
      aria-label={`Scene ${item.index + 1}, ${item.duration.toFixed(1)} seconds`}
      style={{
        ["--x" as string]: left,
        ["--w" as string]: width,
        backgroundImage: url ? `url(${url})` : undefined,
        backgroundColor: url ? undefined : card.bg,
        color: url ? undefined : card.fg,
        textShadow: url ? undefined : "none",
      }}
      onClick={onSelect}
    >
      {item.index + 1}
    </button>
  );
}
