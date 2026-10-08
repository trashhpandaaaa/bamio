"use client";

import { DownloadSimple, Export, FilmSlate, PencilSimple, Play, Trash, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { AiMark } from "@/components/brand";
import { exportUrl, thumbUrl } from "@/lib/clips/api";
import { ASPECT_SHORT, formatBytes } from "@/lib/clips/labels";
import { exportSignature, formatTimecode } from "@/lib/clips/logic";
import type { Clip, Project } from "@/lib/clips/schema";
import styles from "./project.module.css";

/** Where a clip's export stands, compared with its current edit. */
export function exportState(clip: Clip, project: Project) {
  const ex = clip.export;
  if (!ex) return { kind: "none" as const };
  if (ex.status === "queued" || ex.status === "rendering") return { kind: "busy" as const, progress: ex.progress, queued: ex.status === "queued" };
  if (ex.status === "failed") return { kind: "failed" as const, error: ex.error ?? "The export failed." };
  const stale = ex.signature !== undefined && ex.signature !== exportSignature(clip, project.transcriptRev);
  return { kind: "done" as const, stale, bytes: ex.bytes, version: ex.version, href: exportUrl(project.id, clip.id, ex.version) };
}

export function ClipCard({
  project,
  clip,
  onPreview,
  onExport,
  onDelete,
}: {
  project: Project;
  clip: Clip;
  onPreview: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const length = clip.end - clip.start;
  const state = exportState(clip, project);
  const frameAt = clip.start + Math.min(1, length / 2);
  const ratio = clip.edit.aspect.replace(":", " / ");

  return (
    <li className={styles.clip} data-testid="clip-card">
      <button className={styles.clipThumb} type="button" style={{ aspectRatio: ratio }} onClick={onPreview} aria-label={`Preview ${clip.title}`}>
        {/* A frame from our own API; object-position mirrors the clip's crop. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={thumbUrl(project.id, frameAt)}
          alt=""
          loading="lazy"
          style={{ objectFit: clip.edit.framing === "fit" ? "contain" : "cover", objectPosition: `${clip.edit.focusX * 100}% 50%` }}
        />
        <span className={styles.clipPlay} aria-hidden="true">
          <Play size={18} weight="fill" />
        </span>
        <span className={styles.clipDur}>{formatTimecode(length)}</span>
      </button>

      <div className={styles.clipBody}>
        <div className={styles.clipTop}>
          <h3 className={styles.clipTitle}>{clip.title}</h3>
          {clip.origin === "ai" && clip.score !== undefined ? (
            <span className="badge is-live" title="How strong Bamio thinks this clip is, out of 100">
              <AiMark size={11} /> {clip.score}
            </span>
          ) : null}
        </div>
        <p className="card-meta">
          <span className="t-mono">
            {formatTimecode(clip.start)} to {formatTimecode(clip.end)}
          </span>
          <span>{ASPECT_SHORT[clip.edit.aspect]}</span>
          {clip.origin === "manual" ? <span>Marked by you</span> : null}
        </p>
        {clip.reason ? <p className={styles.clipReason}>{clip.reason}</p> : null}

        {state.kind === "busy" ? (
          <div className={styles.clipExport}>
            <span className="t-caption t-secondary">{state.queued ? "Waiting to export" : `Exporting ${Math.round(state.progress * 100)}%`}</span>
            <div className="progress" role="progressbar" aria-label="Export" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(state.progress * 100)}>
              <span style={{ "--value": `${Math.max(2, state.progress * 100)}%` } as React.CSSProperties} />
            </div>
          </div>
        ) : null}
        {state.kind === "failed" ? (
          <p className="field-error">
            <WarningCircle size={14} weight="fill" aria-hidden /> {state.error}
          </p>
        ) : null}
        {state.kind === "done" && state.stale ? <p className="t-caption t-tertiary">Edited since the last export.</p> : null}

        <div className={styles.clipActions}>
          <Link href={`/projects/${project.id}/clips/${clip.id}`} className="btn btn-primary btn-sm">
            <PencilSimple size={16} aria-hidden /> Edit
          </Link>
          {state.kind === "done" && !state.stale ? (
            <>
              <a className="btn btn-secondary btn-sm" href={state.href} download>
                <DownloadSimple size={16} aria-hidden /> Download{state.bytes ? ` (${formatBytes(state.bytes)})` : ""}
              </a>
              {/* The exported clip, opened in the editor (/editor) to add music, text or other clips to it. */}
              <Link className="btn btn-secondary btn-sm" href={`/editor?project=${project.id}&clip=${clip.id}&v=${state.version ?? 0}&name=${encodeURIComponent(clip.title.slice(0, 60))}`} title="Add music, text or other clips in the editor">
                <FilmSlate size={16} aria-hidden /> Open in editor
              </Link>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" type="button" onClick={onExport} disabled={state.kind === "busy"}>
              <Export size={16} aria-hidden /> {state.kind === "done" || state.kind === "failed" ? "Export again" : "Export"}
            </button>
          )}
          <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Delete ${clip.title}`} onClick={onDelete}>
            <Trash size={16} aria-hidden />
          </button>
        </div>
      </div>
    </li>
  );
}
