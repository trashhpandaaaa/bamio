"use client";

import {
  ArrowDown,
  ArrowUp,
  CaretDown,
  CopySimple,
  ImageSquare,
  Microphone,
  Plus,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { useId, useRef, useState, type Dispatch } from "react";
import { AiMark } from "@/components/brand";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SceneThumb } from "@/components/scene-thumb";
import { sceneCanHavePicture, sceneNeedsVoice } from "@/hooks/use-scene-media";
import type { ProjectAction } from "@/lib/project/ops";
import { LIMITS, SHOTS, type Project, type Scene, type Shot } from "@/lib/project/schema";
import { effectiveDuration, isAudioCurrent } from "@/lib/project/timeline";
import styles from "./storyboard.module.css";
import type { Media } from "./workspace";

const SHOT_LABEL: Record<Shot, string> = {
  "close-up": "Close-up",
  medium: "Medium",
  wide: "Wide",
  overhead: "Overhead",
  pov: "Point of view",
  "text-card": "Text card",
};

type Props = { project: Project; dispatch: Dispatch<ProjectAction>; media: Media };

export function StoryboardPanel({ project, dispatch, media }: Props) {
  const [pendingDelete, setPendingDelete] = useState<Scene | null>(null);
  const hookSelectId = useId();
  const missingPictures = project.scenes.filter((s) => sceneCanHavePicture(s) && !s.imageId).length;
  const voiceToDo = project.scenes.filter((s) => sceneNeedsVoice(s, project)).length;
  const anyBusy = media.busy.size > 0;

  return (
    <div className={styles.wrap}>
      {project.hooks.length > 0 ? (
        <div className={styles.hook}>
          <AiMark size={16} />
          <div className={styles.hookBody}>
            <label className="t-caption t-tertiary" htmlFor={hookSelectId}>
              Hook
            </label>
            <div className="select-wrap">
              <select
                id={hookSelectId}
                className={`select ${styles.hookSelect}`}
                value={project.hookId ?? ""}
                onChange={(e) => dispatch({ type: "setHook", hookId: e.target.value })}
              >
                {project.hookId ? null : <option value="">Choose a hook</option>}
                {project.hooks.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.text}
                  </option>
                ))}
              </select>
              <CaretDown size={16} aria-hidden />
            </div>
          </div>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <button className="btn btn-secondary" type="button" disabled={missingPictures === 0 || anyBusy} onClick={() => void media.generateAllPictures()}>
          <ImageSquare size={18} aria-hidden />
          {missingPictures > 0 ? `Make ${missingPictures} ${missingPictures === 1 ? "picture" : "pictures"}` : "All pictures made"}
        </button>
        {project.brief.voiceover ? (
          <button className="btn btn-secondary" type="button" disabled={voiceToDo === 0 || anyBusy} onClick={() => void media.generateAllVoice()}>
            <Microphone size={18} aria-hidden />
            {voiceToDo > 0 ? `Record voice-over (${voiceToDo})` : "Voice-over up to date"}
          </button>
        ) : null}
        <span className={styles.spacer} />
        <span className="t-caption t-tertiary">
          {project.scenes.length} of {LIMITS.maxScenes} scenes
        </span>
      </div>

      <ol className={styles.scenes}>
        {project.scenes.map((scene, i) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            index={i}
            count={project.scenes.length}
            project={project}
            dispatch={dispatch}
            media={media}
            onDelete={() => setPendingDelete(scene)}
          />
        ))}
      </ol>

      <button
        className={`btn btn-secondary ${styles.add}`}
        type="button"
        disabled={project.scenes.length >= LIMITS.maxScenes}
        onClick={() => dispatch({ type: "addScene" })}
      >
        <Plus size={18} aria-hidden />
        Add a scene
      </button>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this scene?"
        body="Its words, picture and voice-over are removed from the video."
        confirmLabel="Delete scene"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => pendingDelete && dispatch({ type: "removeScene", id: pendingDelete.id })}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

function SceneCard({
  scene,
  index,
  count,
  project,
  dispatch,
  media,
  onDelete,
}: {
  scene: Scene;
  index: number;
  count: number;
  project: Project;
  dispatch: Dispatch<ProjectAction>;
  media: Media;
  onDelete: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const id = useId();
  const update = (patch: Partial<Omit<Scene, "id">>) => dispatch({ type: "updateScene", id: scene.id, patch });
  const imgBusy = media.isBusy(`img:${scene.id}`);
  const voiceBusy = media.isBusy(`voice:${scene.id}`);
  const hasVoice = scene.audioId && isAudioCurrent(scene, project.style.voice);
  const played = effectiveDuration(scene, project);

  return (
    <li className={styles.scene} aria-label={`Scene ${index + 1}`}>
      <div
        className={styles.media}
        data-dragging={dragging}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void media.uploadPicture(scene, file);
        }}
      >
        <div className={styles.frame} aria-busy={imgBusy}>
          <SceneThumb scene={scene} index={index} alt={scene.imageId && scene.shot !== "text-card" ? `Picture for scene ${index + 1}` : ""} />
          {imgBusy ? <div className={`skeleton ${styles.frameBusy}`} aria-label="Making the picture" role="status" /> : null}
        </div>
        <div className={styles.mediaActions}>
          {sceneCanHavePicture(scene) ? (
            <button className="btn btn-secondary btn-sm" type="button" disabled={imgBusy} aria-busy={imgBusy} onClick={() => void media.generatePicture(scene)}>
              {imgBusy ? "Making…" : scene.imageId ? "Remake" : "Make picture"}
            </button>
          ) : null}
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Upload a picture for scene ${index + 1}`} title="Upload a picture" disabled={imgBusy} onClick={() => fileRef.current?.click()}>
            <UploadSimple size={16} aria-hidden />
          </button>
          {scene.imageId ? (
            <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Remove the picture from scene ${index + 1}`} title="Remove picture" disabled={imgBusy} onClick={() => media.removePicture(scene)}>
              <X size={16} aria-hidden />
            </button>
          ) : null}
          <input
            ref={fileRef}
            className="sr-only"
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void media.uploadPicture(scene, file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <div className={styles.fields}>
        <div className={styles.sceneHead}>
          <span className={styles.num}>Scene {index + 1}</span>
          <span className="t-mono t-tertiary">{played.toFixed(1)} s</span>
          {project.brief.voiceover && scene.voiceover.trim() ? (
            hasVoice ? (
              <span className="badge is-success">Voice ready</span>
            ) : scene.audioId ? (
              <span className="badge is-warning">Voice out of date</span>
            ) : (
              <span className="badge">No voice yet</span>
            )
          ) : null}
          <span className={styles.spacer} />
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Move scene ${index + 1} up`} disabled={index === 0} onClick={() => dispatch({ type: "moveScene", id: scene.id, delta: -1 })}>
            <ArrowUp size={16} aria-hidden />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Move scene ${index + 1} down`} disabled={index === count - 1} onClick={() => dispatch({ type: "moveScene", id: scene.id, delta: 1 })}>
            <ArrowDown size={16} aria-hidden />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Duplicate scene ${index + 1}`} disabled={count >= LIMITS.maxScenes} onClick={() => dispatch({ type: "duplicateScene", id: scene.id })}>
            <CopySimple size={16} aria-hidden />
          </button>
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Delete scene ${index + 1}`} disabled={count <= 1} onClick={onDelete}>
            <Trash size={16} aria-hidden />
          </button>
        </div>

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
            placeholder="wait for it…"
            value={scene.caption}
            onChange={(e) => update({ caption: e.target.value })}
          />
        </div>

        {project.brief.voiceover ? (
          <div className="field">
            <div className={styles.labelRow}>
              <label className="field-label" htmlFor={`${id}-vo`}>
                Voice-over
              </label>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                disabled={voiceBusy || !scene.voiceover.trim() || Boolean(hasVoice)}
                aria-busy={voiceBusy}
                onClick={() => void media.generateVoice(scene)}
              >
                {voiceBusy ? null : <Microphone size={16} aria-hidden />}
                {voiceBusy ? "Recording…" : hasVoice ? "Recorded" : "Record"}
              </button>
            </div>
            <textarea
              id={`${id}-vo`}
              className="textarea"
              name="voiceover"
              autoComplete="off"
              rows={2}
              maxLength={LIMITS.voiceover}
              placeholder="What is said in this scene…"
              value={scene.voiceover}
              onChange={(e) => update({ voiceover: e.target.value })}
            />
          </div>
        ) : null}

        <div className="field">
          <label className="field-label" htmlFor={`${id}-vis`}>
            What we see
          </label>
          <textarea
            id={`${id}-vis`}
            className="textarea"
            name="visual"
            autoComplete="off"
            rows={2}
            maxLength={LIMITS.visual}
            placeholder="A close-up of cold brew pouring over ice, morning light…"
            value={scene.visual}
            onChange={(e) => update({ visual: e.target.value })}
          />
          <p className="field-help">Used to make the picture. Describe the subject, setting and light.</p>
        </div>

        <div className={styles.row2}>
          <div className="field">
            <label className="field-label" htmlFor={`${id}-shot`}>
              Shot
            </label>
            <div className="select-wrap">
              <select id={`${id}-shot`} className="select" name="shot" value={scene.shot} onChange={(e) => update({ shot: e.target.value as Shot })}>
                {SHOTS.map((s) => (
                  <option key={s} value={s}>
                    {SHOT_LABEL[s]}
                  </option>
                ))}
              </select>
              <CaretDown size={16} aria-hidden />
            </div>
          </div>
          <DurationField id={`${id}-dur`} value={scene.durationSec} onCommit={(durationSec) => update({ durationSec })} />
        </div>
      </div>
    </li>
  );
}

/** Seconds input that commits on blur or Enter, so typing "0.5" is not clamped mid-way. */
export function DurationField({ id, value, onCommit }: { id: string; value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number.parseFloat(draft);
    if (Number.isFinite(n)) onCommit(Math.round(Math.min(LIMITS.sceneMax, Math.max(LIMITS.sceneMin, n)) * 10) / 10);
    setDraft(null);
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Length (seconds)
      </label>
      <input
        id={id}
        className="input"
        type="number"
        inputMode="decimal"
        name="duration"
        min={LIMITS.sceneMin}
        max={LIMITS.sceneMax}
        step={0.5}
        value={draft ?? String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
      />
    </div>
  );
}
