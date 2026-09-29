"use client";

import { ArrowCounterClockwise, ArrowLeft, ArrowSquareOut, Check, PencilSimple, Plus, Scissors, Trash, Warning, WarningCircle, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AiMark } from "@/components/brand";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { JobSteps } from "@/components/job-steps";
import { PlatformIcon } from "@/components/platform-icon";
import { useToast } from "@/components/toast";
import { useProject, useSystemStatus } from "@/hooks/use-project";
import { api } from "@/lib/clips/api";
import { CLIP_LENGTH_LABEL } from "@/lib/clips/labels";
import { clipRangeError, formatTimecode, parseTimecode, sortClips } from "@/lib/clips/logic";
import { languageName } from "@/lib/clips/languages";
import { CLIP_LENGTHS, isJobActive, LIMITS, needsRetranscribe, type Clip, type ClipLength, type Project } from "@/lib/clips/schema";
import { PLATFORM_LABEL } from "@/lib/clips/url";
import { ClipCard } from "./clip-card";
import { SourcePlayer, type PlayerHandle } from "./source-player";
import styles from "./project.module.css";

export function ProjectView({ id }: { id: string }) {
  const { project, error, refresh, setProject } = useProject(id);

  if (error && !project) {
    return (
      <main id="main" className="container state-panel">
        <h1 className="t-heading-lg">{error.status === 404 ? "This project isn’t here." : "Couldn’t load this project."}</h1>
        <p>{error.message}</p>
        <div style={{ display: "flex", gap: 8 }}>
          {error.status !== 404 ? (
            <button className="btn btn-primary" type="button" onClick={refresh}>
              Try again
            </button>
          ) : null}
          <Link href="/projects" className="btn btn-secondary">
            All projects
          </Link>
        </div>
      </main>
    );
  }
  if (!project) {
    return (
      <main id="main" className={`container ${styles.page}`} aria-busy="true">
        <div className="skeleton" style={{ height: 36, width: "40%" }} />
        <div className="skeleton" style={{ aspectRatio: "16 / 9", borderRadius: "var(--r-lg)" }} />
      </main>
    );
  }
  return <ProjectScreen project={project} setProject={setProject} />;
}

function ProjectScreen({ project, setProject }: { project: Project; setProject: (p: Project) => void }) {
  const router = useRouter();
  const toast = useToast();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const status = project.job.status;
  const ready = status === "ready";

  async function deleteProject() {
    try {
      await api.deleteProject(project.id);
      toast({ tone: "success", title: "Project deleted" });
      router.push("/projects");
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t delete the project", body: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <main id="main" className={`container ${styles.page}`}>
      <ProjectHeader project={project} setProject={setProject} onDelete={() => setConfirmDelete(true)} />

      {isJobActive(status) ? (
        <section className={`studio ${styles.processing}`} aria-label="Processing">
          <JobSteps project={project} />
          <p className="t-body-sm t-secondary">
            {status === "uploading"
              ? "The upload continues in the tab where you started it. Keep that tab open."
              : status === "recording"
                ? "Recording on the server: you can leave this page. Stop early to process what’s been recorded so far."
                : "You can leave this page. Processing continues on the server, and your clips will be here when it’s done."}
          </p>
          {status === "recording" ? <StopRecording project={project} setProject={setProject} /> : null}
        </section>
      ) : null}

      {status === "failed" ? <FailedPanel project={project} setProject={setProject} /> : null}

      {ready ? <Workspace project={project} setProject={setProject} /> : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this project?"
        body="The imported video, its clips and their exports will be deleted. This can’t be undone."
        confirmLabel="Delete project"
        destructive
        onConfirm={() => void deleteProject()}
        onClose={() => setConfirmDelete(false)}
      />
    </main>
  );
}

function ProjectHeader({ project, setProject, onDelete }: { project: Project; setProject: (p: Project) => void; onDelete: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(project.title);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const src = project.source;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const next = title.trim();
    if (!next || next === project.title) return setEditing(false);
    setSaving(true);
    try {
      setProject(await api.renameProject(project.id, next.slice(0, LIMITS.title)));
      setEditing(false);
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t rename the project", body: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  return (
    <header className={styles.head}>
      <Link href="/projects" className={`btn btn-ghost btn-sm ${styles.back}`}>
        <ArrowLeft size={16} aria-hidden /> Projects
      </Link>
      <div className={styles.titleRow}>
        {editing ? (
          <form className={styles.renameForm} onSubmit={(e) => void save(e)}>
            <label className="sr-only" htmlFor={inputId}>
              Project name
            </label>
            <input id={inputId} className="input" value={title} maxLength={LIMITS.title} onChange={(e) => setTitle(e.target.value)} autoFocus disabled={saving} />
            <button className="btn btn-primary btn-icon" type="submit" aria-label="Save name" aria-busy={saving}>
              <Check size={18} aria-hidden />
            </button>
            <button
              className="btn btn-ghost btn-icon"
              type="button"
              aria-label="Cancel renaming"
              onClick={() => {
                setTitle(project.title);
                setEditing(false);
              }}
            >
              <X size={18} aria-hidden />
            </button>
          </form>
        ) : (
          <>
            <h1 className={`t-heading-xl ${styles.title}`}>{project.title}</h1>
            <button
              className="btn btn-ghost btn-icon btn-sm"
              type="button"
              aria-label="Rename project"
              onClick={() => {
                setTitle(project.title);
                setEditing(true);
              }}
            >
              <PencilSimple size={16} aria-hidden />
            </button>
          </>
        )}
        <button className={`btn btn-ghost btn-sm ${styles.deleteProject}`} type="button" onClick={onDelete}>
          <Trash size={16} aria-hidden /> Delete
        </button>
      </div>
      <p className="card-meta">
        <span className="badge">
          <PlatformIcon platform={src.platform} size={14} /> {PLATFORM_LABEL[src.platform]}
        </span>
        {src.uploader ? <span>{src.uploader}</span> : null}
        {src.durationSec > 0 ? <span className="t-mono">{formatTimecode(src.durationSec)}</span> : null}
        {project.spokenLanguage ? <span>{languageName(project.spokenLanguage)}</span> : null}
        {src.range ? (
          <span>
            Part {formatTimecode(src.range.start)} to {formatTimecode(src.range.end)}
          </span>
        ) : null}
        {src.live ? (
          <span>
            Captured live {new Date(src.live.requestedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
          </span>
        ) : null}
        {src.url ? (
          <a className="link" href={src.url} target="_blank" rel="noreferrer noopener">
            Original <ArrowSquareOut size={12} aria-hidden />
          </a>
        ) : null}
      </p>
    </header>
  );
}

function StopRecording({ project, setProject }: { project: Project; setProject: (p: Project) => void }) {
  const toast = useToast();
  const [stopping, setStopping] = useState(false);
  async function stop() {
    setStopping(true);
    try {
      setProject(await api.stopRecording(project.id));
    } catch (err) {
      setStopping(false);
      toast({ tone: "error", title: "Couldn’t stop the recording", body: err instanceof Error ? err.message : undefined });
    }
  }
  return (
    <div>
      <button className="btn btn-secondary" type="button" onClick={() => void stop()} disabled={stopping} aria-busy={stopping}>
        {stopping ? "Stopping…" : "Stop recording now"}
      </button>
    </div>
  );
}

function FailedPanel({ project, setProject }: { project: Project; setProject: (p: Project) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const canRetry = !(project.source.kind === "upload" && project.upload && project.upload.received < project.upload.size);

  async function retry() {
    setBusy(true);
    try {
      setProject(await api.retry(project.id));
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t restart the import", body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.failed} role="alert">
      <WarningCircle size={28} weight="fill" aria-hidden />
      <div>
        <h2 className="t-heading-md">The import didn’t finish</h2>
        <p>{project.job.error ?? "Something went wrong."}</p>
      </div>
      <div className={styles.failedActions}>
        {canRetry ? (
          <button className="btn btn-primary" type="button" onClick={() => void retry()} aria-busy={busy} disabled={busy}>
            <ArrowCounterClockwise size={18} aria-hidden /> Try again
          </button>
        ) : null}
        <Link href="/new" className="btn btn-secondary">
          New import
        </Link>
      </div>
    </section>
  );
}

type Sort = "best" | "time";

function Workspace({ project, setProject }: { project: Project; setProject: (p: Project) => void }) {
  const toast = useToast();
  const status = useSystemStatus();
  const player = useRef<PlayerHandle>(null);
  const markId = useId();
  const [markIn, setMarkIn] = useState("");
  const [markOut, setMarkOut] = useState("");
  const [adding, setAdding] = useState(false);
  const [findLength, setFindLength] = useState<ClipLength>(project.clipLength);
  const [finding, setFinding] = useState(false);
  const [deleting, setDeleting] = useState<Clip | null>(null);
  const [sort, setSort] = useState<Sort>("best");
  const [retranscribing, setRetranscribing] = useState(false);

  const aiOn = status?.ai.configured !== false;
  const duration = project.source.durationSec;
  const inSec = markIn.trim() ? parseTimecode(markIn) : null;
  const outSec = markOut.trim() ? parseTimecode(markOut) : null;
  const markProblem =
    markIn.trim() && inSec === null
      ? "Enter the start as a time, like 1:30."
      : markOut.trim() && outSec === null
        ? "Enter the end as a time, like 2:05."
        : inSec !== null && outSec !== null
          ? clipRangeError(inSec, outSec, duration)
          : null;

  const clips = useMemo(() => sortClips(project.clips, sort), [project.clips, sort]);

  // Keyboard: I and O mark the clip, Space plays and pauses (not while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (target?.closest("input, textarea, select, [contenteditable], dialog")) return;
      const t = player.current?.currentTime() ?? 0;
      if (e.key === "i" || e.key === "I") setMarkIn(formatTimecode(t, { hundredths: true }));
      else if (e.key === "o" || e.key === "O") setMarkOut(formatTimecode(t, { hundredths: true }));
      else if (e.key === " " && !target?.closest("button, a, [role=slider]")) player.current?.togglePlay();
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  async function addClip(e: React.FormEvent) {
    e.preventDefault();
    if (inSec === null || outSec === null || markProblem) return;
    setAdding(true);
    try {
      const { project: next } = await api.addClip(project.id, { start: inSec, end: outSec });
      setProject(next);
      setMarkIn("");
      setMarkOut("");
      toast({ tone: "success", title: "Clip added", body: `${formatTimecode(inSec)} to ${formatTimecode(outSec)}` });
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t add the clip", body: err instanceof Error ? err.message : undefined });
    } finally {
      setAdding(false);
    }
  }

  async function findClips() {
    setFinding(true);
    try {
      setProject(await api.findClips(project.id, findLength));
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t start finding clips", body: err instanceof Error ? err.message : undefined });
    } finally {
      setFinding(false);
    }
  }

  async function retranscribe() {
    setRetranscribing(true);
    try {
      setProject(await api.retranscribe(project.id));
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t start transcribing", body: err instanceof Error ? err.message : undefined });
    } finally {
      setRetranscribing(false);
    }
  }

  async function exportClip(clip: Clip) {
    try {
      setProject(await api.exportClip(project.id, clip.id));
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t start the export", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function deleteClip(clip: Clip) {
    try {
      setProject(await api.deleteClip(project.id, clip.id));
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t delete the clip", body: err instanceof Error ? err.message : undefined });
    }
  }

  const hasAi = project.clips.some((c) => c.origin === "ai");

  return (
    <div className={styles.workspace}>
      <section className={`studio ${styles.stage}`} aria-label="Source video">
        <SourcePlayer
          ref={player}
          projectId={project.id}
          durationSec={duration}
          clips={project.clips}
          mark={{ start: inSec, end: outSec }}
          onPickClip={(c) => player.current?.playRange(c.start, c.end)}
        />

        <form className={styles.mark} onSubmit={(e) => void addClip(e)} aria-labelledby={`${markId}-title`}>
          <h2 id={`${markId}-title`} className="t-heading-sm">
            Mark a clip
          </h2>
          <div className={styles.markRow}>
            <div className="field">
              <label className="field-label" htmlFor={`${markId}-in`}>
                Start
              </label>
              <div className={styles.markInput}>
                <input id={`${markId}-in`} className={`input ${styles.time}`} placeholder="0:00" value={markIn} onChange={(e) => setMarkIn(e.target.value)} />
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setMarkIn(formatTimecode(player.current?.currentTime() ?? 0, { hundredths: true }))}>
                  Set <kbd className="kbd">I</kbd>
                </button>
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${markId}-out`}>
                End
              </label>
              <div className={styles.markInput}>
                <input id={`${markId}-out`} className={`input ${styles.time}`} placeholder="0:30" value={markOut} onChange={(e) => setMarkOut(e.target.value)} />
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setMarkOut(formatTimecode(player.current?.currentTime() ?? 0, { hundredths: true }))}>
                  Set <kbd className="kbd">O</kbd>
                </button>
              </div>
            </div>
            <button className="btn btn-volt" type="submit" disabled={inSec === null || outSec === null || Boolean(markProblem) || adding} aria-busy={adding}>
              <Plus size={18} weight="bold" aria-hidden /> Add clip
            </button>
          </div>
          {markProblem ? (
            <p className="field-error" role="alert">
              <WarningCircle size={14} weight="fill" aria-hidden /> {markProblem}
            </p>
          ) : (
            <p className="field-help">
              {inSec !== null && outSec !== null ? `${formatTimecode(outSec - inSec, { hundredths: true })} long. ` : ""}
              Play the video and press I at the start and O at the end. Space plays and pauses.
            </p>
          )}
        </form>
      </section>

      <section className={styles.clipsPanel} aria-labelledby="clips-title">
        <div className={styles.clipsHead}>
          <h2 id="clips-title" className="t-heading-md">
            Clips <span className="t-tertiary">{project.clips.length}</span>
          </h2>
          {project.clips.length > 1 ? (
            <div className="seg" role="group" aria-label="Sort clips">
              <button type="button" aria-pressed={sort === "best"} onClick={() => setSort("best")}>
                Best first
              </button>
              <button type="button" aria-pressed={sort === "time"} onClick={() => setSort("time")}>
                In order
              </button>
            </div>
          ) : null}
        </div>

        {project.job.warning ? (
          <div className="notice is-warning">
            <Warning size={20} weight="fill" aria-hidden />
            <p>{project.job.warning}</p>
          </div>
        ) : null}

        {needsRetranscribe(project) ? (
          <div className="notice is-warning">
            <Warning size={20} weight="fill" aria-hidden />
            <div className={styles.noticeBody}>
              <p>
                <strong>Transcribe this video again for accurate timing</strong>
                It was transcribed before on-device transcription, so caption timing and AI clip edges can be off, especially in long videos.
              </p>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => void retranscribe()} disabled={retranscribing}>
                Transcribe again
              </button>
            </div>
          </div>
        ) : null}

        {aiOn && project.source.hasAudio ? (
          <div className={styles.find}>
            <p className={styles.findText}>
              <AiMark size={15} /> {hasAi ? "Find more clips with AI" : "Let Bamio find the best moments"}
            </p>
            <div className={styles.findRow}>
              <div className="select-wrap">
                <label className="sr-only" htmlFor="find-length">
                  Clip length
                </label>
                <select id="find-length" className="select" value={findLength} onChange={(e) => setFindLength(e.target.value as ClipLength)}>
                  {CLIP_LENGTHS.map((l) => (
                    <option key={l} value={l}>
                      {CLIP_LENGTH_LABEL[l]}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" type="button" onClick={() => void findClips()} disabled={finding || project.clips.length >= LIMITS.maxClips} aria-busy={finding}>
                {hasAi ? "Find more" : "Find clips"}
              </button>
            </div>
          </div>
        ) : null}

        {clips.length === 0 ? (
          <div className="empty">
            <Scissors size={36} aria-hidden />
            <h3 className="empty-title">No clips yet</h3>
            <p className="empty-body">Mark a start and an end on the video to cut your first clip{aiOn && project.source.hasAudio ? ", or let Bamio find some" : ""}.</p>
          </div>
        ) : (
          <ul className={styles.clipList}>
            {clips.map((clip) => (
              <ClipCard
                key={clip.id}
                project={project}
                clip={clip}
                onPreview={() => player.current?.playRange(clip.start, clip.end)}
                onExport={() => void exportClip(clip)}
                onDelete={() => setDeleting(clip)}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this clip?"
        body={`“${deleting?.title ?? ""}” and its export will be deleted.`}
        confirmLabel="Delete clip"
        destructive
        onConfirm={() => deleting && void deleteClip(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
