"use client";

import {
  ArrowLeft,
  CaretLeft,
  CaretRight,
  Check,
  CopySimple,
  DownloadSimple,
  Export,
  Pause,
  Play,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AiMark } from "@/components/brand";
import { useToast } from "@/components/toast";
import { useProject, useTranscript } from "@/hooks/use-project";
import { api, exportUrl, type ClipPatch } from "@/lib/clips/api";
import { ASPECT_LABEL, CAPTION_POSITION_LABEL, CAPTION_STYLE_HELP, CAPTION_STYLE_LABEL, formatBytes } from "@/lib/clips/labels";
import { captionLines, clipRangeError, cropRect, formatTimecode, overlayTitle, parseTimecode, sortClips, splitWords } from "@/lib/clips/logic";
import { ASPECTS, CAPTION_POSITIONS, CAPTION_STYLES, isJobActive, LIMITS, needsRetranscribe, type Clip, type ClipEdit, type Project } from "@/lib/clips/schema";
import { exportState } from "../../clip-card";
import { ClipPreview, type PreviewHandle } from "./clip-preview";
import { TrimBar } from "./trim-bar";
import styles from "./editor.module.css";

export function ClipEditor({ projectId, clipId }: { projectId: string; clipId: string }) {
  const { project, error, setProject } = useProject(projectId);
  const clip = project?.clips.find((c) => c.id === clipId);

  if (error && !project) {
    return (
      <main id="main" className="container state-panel">
        <h1 className="t-heading-lg">Couldn’t open this clip.</h1>
        <p>{error.message}</p>
        <Link href="/projects" className="btn btn-primary">
          All projects
        </Link>
      </main>
    );
  }
  if (!project) {
    return (
      <main id="main" className={`studio ${styles.shell}`} aria-busy="true">
        <div className={styles.loading}>
          <div className="skeleton" style={{ width: 280, aspectRatio: "9 / 16", borderRadius: "var(--r-frame)" }} />
        </div>
      </main>
    );
  }
  if (!clip) {
    return (
      <main id="main" className="container state-panel">
        <h1 className="t-heading-lg">This clip isn’t here.</h1>
        <p>It may have been deleted.</p>
        <Link href={`/projects/${projectId}`} className="btn btn-primary">
          Back to the project
        </Link>
      </main>
    );
  }
  return <Editor key={clip.id} project={project} clip={clip} setProject={setProject} />;
}

type Draft = { title: string; start: number; end: number; edit: ClipEdit };
type SaveState = "saved" | "saving" | "error";

function Editor({ project, clip, setProject }: { project: Project; clip: Clip; setProject: (p: Project) => void }) {
  const toast = useToast();
  const id = useId();
  const preview = useRef<PreviewHandle>(null);
  const [draft, setDraft] = useState<Draft>({ title: clip.title, start: clip.start, end: clip.end, edit: clip.edit });
  const [time, setTime] = useState(clip.start);
  const [playing, setPlaying] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [startText, setStartText] = useState(formatTimecode(clip.start, { hundredths: true }));
  const [endText, setEndText] = useState(formatTimecode(clip.end, { hundredths: true }));
  const [view, setView] = useState(() => viewAround(clip.start, clip.end, project.source.durationSec));
  const [exporting, setExporting] = useState(false);
  const [watching, setWatching] = useState(false);
  const { transcript, setTranscript } = useTranscript(project.id, project.hasTranscript, project.transcriptRev);

  /* ---------- Saving: changes are batched and sent 400 ms after the last edit ---------- */
  const pending = useRef<ClipPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const chain = useRef<Promise<void>>(Promise.resolve());

  const flush = useCallback((): Promise<void> => {
    clearTimeout(timer.current);
    chain.current = chain.current.then(async () => {
      const patch = pending.current;
      if (Object.keys(patch).length === 0) return;
      pending.current = {};
      try {
        const next = await api.updateClip(project.id, clip.id, patch);
        setProject(next);
        if (Object.keys(pending.current).length === 0) setSaveState("saved");
      } catch (err) {
        pending.current = { ...patch, ...pending.current, edit: { ...patch.edit, ...pending.current.edit } };
        setSaveState("error");
        toast({ tone: "error", title: "Couldn’t save your change", body: err instanceof Error ? err.message : undefined });
      }
    });
    return chain.current;
  }, [project.id, clip.id, setProject, toast]);

  const queue = useCallback(
    (patch: ClipPatch) => {
      const prev = pending.current;
      pending.current = { ...prev, ...patch, ...(patch.edit || prev.edit ? { edit: { ...prev.edit, ...patch.edit } } : {}) };
      setSaveState("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 400);
    },
    [flush],
  );

  // Send anything unsaved when leaving the page.
  useEffect(() => {
    const send = () => {
      const patch = pending.current;
      if (Object.keys(patch).length === 0) return;
      pending.current = {};
      void fetch(`/api/projects/${project.id}/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        keepalive: true,
      });
    };
    window.addEventListener("pagehide", send);
    return () => {
      window.removeEventListener("pagehide", send);
      clearTimeout(timer.current);
      send();
    };
  }, [project.id, clip.id]);

  /* ---------- Edits ---------- */
  const setEdit = (patch: Partial<ClipEdit>) => {
    setDraft((d) => ({ ...d, edit: { ...d.edit, ...patch } }));
    queue({ edit: patch });
  };

  const setRange = (start: number, end: number, edge?: "start" | "end") => {
    setDraft((d) => ({ ...d, start, end }));
    setStartText(formatTimecode(start, { hundredths: true }));
    setEndText(formatTimecode(end, { hundredths: true }));
    // Show the frame at the edge being moved.
    if (edge === "start") preview.current?.seek(start);
    if (edge === "end") preview.current?.seek(Math.max(start, end - 0.05));
  };

  const commitRange = (start = draft.start, end = draft.end) => {
    if (clipRangeError(start, end, project.source.durationSec)) return;
    setView((v) => (start < v.from || end > v.to ? viewAround(start, end, project.source.durationSec) : v));
    queue({ start, end });
  };

  const commitTyped = (edge: "start" | "end") => {
    const parsed = parseTimecode(edge === "start" ? startText : endText);
    const start = edge === "start" && parsed !== null ? parsed : draft.start;
    const end = edge === "end" && parsed !== null ? parsed : draft.end;
    if (parsed === null || clipRangeError(start, end, project.source.durationSec)) {
      setStartText(formatTimecode(draft.start, { hundredths: true }));
      setEndText(formatTimecode(draft.end, { hundredths: true }));
      return;
    }
    setRange(start, end, edge);
    commitRange(start, end);
  };

  const rangeError = clipRangeError(parseTimecode(startText) ?? NaN, parseTimecode(endText) ?? NaN, project.source.durationSec);

  const setAtPlayhead = (edge: "start" | "end") => {
    const t = Math.round((preview.current?.time() ?? time) * 100) / 100;
    const start = edge === "start" ? t : draft.start;
    const end = edge === "end" ? t : draft.end;
    const problem = clipRangeError(start, end, project.source.durationSec);
    if (problem) {
      toast({ tone: "error", title: edge === "start" ? "Can’t start the clip there" : "Can’t end the clip there", body: problem });
      return;
    }
    setRange(start, end);
    commitRange(start, end);
  };

  /* ---------- Keyboard: Space plays, I and O set the ends at the playhead ---------- */
  const keyActions = useRef({ setAtPlayhead });
  useEffect(() => {
    keyActions.current = { setAtPlayhead };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (target?.closest("input, textarea, select, [contenteditable], dialog")) return;
      if (e.key === " " && !target?.closest("button, a, [role=slider]")) preview.current?.toggle();
      else if (e.key === "i" || e.key === "I") keyActions.current.setAtPlayhead("start");
      else if (e.key === "o" || e.key === "O") keyActions.current.setAtPlayhead("end");
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  /* ---------- Captions ---------- */
  const lines = useMemo(
    () => (transcript ? captionLines(transcript.segments, draft.start, draft.end, draft.edit.captionStyle) : []),
    [transcript, draft.start, draft.end, draft.edit.captionStyle],
  );
  const phrases = useMemo(
    () => (transcript?.segments ?? []).map((s, index) => ({ ...s, index })).filter((s) => s.end > draft.start && s.start < draft.end),
    [transcript, draft.start, draft.end],
  );

  async function saveSegment(index: number, text: string) {
    if (!transcript || transcript.segments[index]?.text === text.trim()) return;
    const clean = text.replace(/\s+/g, " ").trim();
    // Same as the server: measured word times survive only if the word count is unchanged.
    const segments = transcript.segments.map((s, i) =>
      i === index ? { ...s, text: clean, words: splitWords(clean).length === splitWords(s.text).length ? s.words : undefined } : s,
    );
    setTranscript({ ...transcript, segments });
    try {
      const { transcriptRev } = await api.updateSegment(project.id, index, text);
      setProject({ ...project, transcriptRev });
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t save the caption", body: err instanceof Error ? err.message : undefined });
    }
  }

  /* ---------- Export ---------- */
  const current: Clip = { ...clip, title: draft.title, start: draft.start, end: draft.end, edit: draft.edit };
  const state = exportState(current, project);

  async function startExport() {
    setExporting(true);
    try {
      await flush();
      setProject(await api.exportClip(project.id, clip.id));
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t start the export", body: err instanceof Error ? err.message : undefined });
    } finally {
      setExporting(false);
    }
  }

  async function retranscribe() {
    try {
      await flush();
      setProject(await api.retranscribe(project.id));
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t start transcribing", body: err instanceof Error ? err.message : undefined });
    }
  }

  async function applyToAll() {
    try {
      await flush();
      setProject(await api.applyLook(project.id, clip.id));
      toast({ tone: "success", title: "Look applied to every clip", body: "Format and caption style now match this clip. New clips start with it too." });
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t apply the look", body: err instanceof Error ? err.message : undefined });
    }
  }

  /* ---------- Layout ---------- */
  const ordered = sortClips(project.clips, "best");
  const index = ordered.findIndex((c) => c.id === clip.id);
  const prev = index > 0 ? ordered[index - 1] : undefined;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined;
  const srcW = project.source.width;
  const srcH = project.source.height;
  const canPan = draft.edit.framing === "crop" && srcW - cropRect(srcW, srcH, draft.edit.aspect, draft.edit.focusX).w > 2;
  const length = draft.end - draft.start;
  const title = overlayTitle({ title: draft.title, edit: draft.edit });

  return (
    <main id="main" className={`studio ${styles.shell}`}>
      <div className={styles.bar}>
        <Link href={`/projects/${project.id}`} className="btn btn-ghost btn-sm">
          <ArrowLeft size={16} aria-hidden /> <span className={styles.barProject}>{project.title}</span>
        </Link>
        <div className={styles.barTitle}>
          <label className="sr-only" htmlFor={`${id}-title`}>
            Clip name
          </label>
          <input
            id={`${id}-title`}
            className={styles.titleInput}
            value={draft.title}
            maxLength={LIMITS.clipTitle}
            onChange={(e) => {
              setDraft((d) => ({ ...d, title: e.target.value }));
              if (e.target.value.trim()) queue({ title: e.target.value.trim() });
            }}
            onBlur={() => {
              if (!draft.title.trim()) setDraft((d) => ({ ...d, title: clip.title }));
            }}
          />
          <span className={styles.saveState} data-state={saveState} role="status">
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : (
              <>
                <Check size={14} aria-hidden /> Saved
              </>
            )}
          </span>
        </div>
        <nav className={styles.barNav} aria-label="Other clips">
          {prev ? (
            <Link href={`/projects/${project.id}/clips/${prev.id}`} className="btn btn-ghost btn-icon btn-sm" aria-label="Previous clip">
              <CaretLeft size={16} aria-hidden />
            </Link>
          ) : (
            <span className="btn btn-ghost btn-icon btn-sm" aria-disabled="true">
              <CaretLeft size={16} aria-hidden />
            </span>
          )}
          <span className="t-mono t-tertiary">
            {index + 1}/{ordered.length}
          </span>
          {next ? (
            <Link href={`/projects/${project.id}/clips/${next.id}`} className="btn btn-ghost btn-icon btn-sm" aria-label="Next clip">
              <CaretRight size={16} aria-hidden />
            </Link>
          ) : (
            <span className="btn btn-ghost btn-icon btn-sm" aria-disabled="true">
              <CaretRight size={16} aria-hidden />
            </span>
          )}
        </nav>
        <ExportButton state={state} busy={exporting} onExport={() => void startExport()} onWatch={() => setWatching(true)} />
      </div>

      <div className={styles.body}>
        <section className={styles.stage} aria-label="Preview">
          <div className={styles.frameWrap}>
            <ClipPreview
              ref={preview}
              projectId={project.id}
              srcW={srcW}
              srcH={srcH}
              start={draft.start}
              end={draft.end}
              edit={draft.edit}
              lines={lines}
              title={title}
              onTime={setTime}
              onPlaying={setPlaying}
              onFocusX={(focusX) => setEdit({ focusX: Math.round(focusX * 1000) / 1000 })}
            />
          </div>

          <div className={styles.transport}>
            <button className="btn btn-volt btn-icon" type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => preview.current?.toggle()}>
              {playing ? <Pause size={20} weight="fill" aria-hidden /> : <Play size={20} weight="fill" aria-hidden />}
            </button>
            <span className="timecode">
              <b>{formatTimecode(Math.min(length, Math.max(0, time - draft.start)), { hundredths: true })}</b> / {formatTimecode(length, { hundredths: true })}
            </span>
            {canPan ? <span className={styles.hint}>Drag the picture to reframe</span> : null}
          </div>

          <TrimBar
            projectId={project.id}
            duration={project.source.durationSec}
            view={view}
            start={draft.start}
            end={draft.end}
            time={time}
            onChange={(s, e, edge) => setRange(s, e, edge)}
            onCommit={() => commitRange()}
            onSeek={(t) => preview.current?.seek(t)}
          />

          <div className={styles.times}>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-start`}>
                Start
              </label>
              <div className={styles.timeRow}>
                <input
                  id={`${id}-start`}
                  className={`input ${styles.time}`}
                  value={startText}
                  aria-invalid={rangeError && parseTimecode(startText) === null ? true : undefined}
                  onChange={(e) => setStartText(e.target.value)}
                  onBlur={() => commitTyped("start")}
                  onKeyDown={(e) => e.key === "Enter" && commitTyped("start")}
                />
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAtPlayhead("start")}>
                  Playhead <kbd className="kbd">I</kbd>
                </button>
              </div>
            </div>
            <div className="field">
              <label className="field-label" htmlFor={`${id}-end`}>
                End
              </label>
              <div className={styles.timeRow}>
                <input
                  id={`${id}-end`}
                  className={`input ${styles.time}`}
                  value={endText}
                  aria-invalid={rangeError && parseTimecode(endText) === null ? true : undefined}
                  onChange={(e) => setEndText(e.target.value)}
                  onBlur={() => commitTyped("end")}
                  onKeyDown={(e) => e.key === "Enter" && commitTyped("end")}
                />
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAtPlayhead("end")}>
                  Playhead <kbd className="kbd">O</kbd>
                </button>
              </div>
            </div>
          </div>
          {rangeError && (parseTimecode(startText) !== draft.start || parseTimecode(endText) !== draft.end) ? (
            <p className="field-error">
              <WarningCircle size={14} weight="fill" aria-hidden /> {rangeError}
            </p>
          ) : null}
        </section>

        <aside className={styles.inspector} aria-label="Clip settings">
          {clip.origin === "ai" && clip.reason ? (
            <p className={styles.why}>
              <AiMark size={14} />
              <span>
                <strong>Why Bamio picked this{clip.score !== undefined ? ` (${clip.score}/100)` : ""}</strong> {clip.reason}
              </span>
            </p>
          ) : null}

          <section className={styles.group} aria-labelledby={`${id}-frame`}>
            <h2 id={`${id}-frame`} className={styles.groupTitle}>
              Frame
            </h2>
            <div className="seg" role="group" aria-label="Format">
              {ASPECTS.map((a) => (
                <button key={a} type="button" aria-pressed={draft.edit.aspect === a} onClick={() => setEdit({ aspect: a })}>
                  {ASPECT_LABEL[a]}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Framing">
              <button type="button" aria-pressed={draft.edit.framing === "crop"} onClick={() => setEdit({ framing: "crop" })}>
                Fill (crop)
              </button>
              <button type="button" aria-pressed={draft.edit.framing === "fit"} onClick={() => setEdit({ framing: "fit" })}>
                Fit whole frame
              </button>
            </div>
            {canPan ? (
              <div className="field">
                <label className="field-label" htmlFor={`${id}-focus`}>
                  Focus
                </label>
                <input
                  id={`${id}-focus`}
                  className={styles.range}
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(draft.edit.focusX * 100)}
                  aria-valuetext={draft.edit.focusX < 0.4 ? "Left" : draft.edit.focusX > 0.6 ? "Right" : "Centre"}
                  onChange={(e) => setEdit({ focusX: Number(e.target.value) / 100 })}
                />
                <p className="field-help">Which part of the picture stays in the frame.</p>
              </div>
            ) : null}
          </section>

          <section className={styles.group} aria-labelledby={`${id}-cap`}>
            <div className={styles.groupHead}>
              <h2 id={`${id}-cap`} className={styles.groupTitle}>
                Captions
              </h2>
              <input
                className="switch"
                type="checkbox"
                role="switch"
                aria-label="Show captions"
                checked={draft.edit.captions}
                disabled={!project.hasTranscript}
                onChange={(e) => setEdit({ captions: e.target.checked })}
              />
            </div>
            {!project.hasTranscript ? (
              <p className="field-help">No transcript for this video, so captions aren’t available. Use Find clips on the project page to transcribe it.</p>
            ) : (
              <>
                <TranscriptStatus project={project} onRetranscribe={() => void retranscribe()} />
                <div className={styles.styleChips} role="group" aria-label="Caption style">
                  {CAPTION_STYLES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={styles.styleChip}
                      data-style={s}
                      aria-pressed={draft.edit.captionStyle === s}
                      disabled={!draft.edit.captions}
                      onClick={() => setEdit({ captionStyle: s })}
                    >
                      <span className={styles.styleSample} aria-hidden="true">
                        <span>Aa</span>
                      </span>
                      <span className={styles.styleName}>{CAPTION_STYLE_LABEL[s]}</span>
                      <span className="sr-only">: {CAPTION_STYLE_HELP[s]}</span>
                    </button>
                  ))}
                </div>
                <div className="seg" role="group" aria-label="Caption position">
                  {CAPTION_POSITIONS.map((p) => (
                    <button key={p} type="button" aria-pressed={draft.edit.captionPosition === p} disabled={!draft.edit.captions} onClick={() => setEdit({ captionPosition: p })}>
                      {CAPTION_POSITION_LABEL[p]}
                    </button>
                  ))}
                </div>
                {phrases.length > 0 ? (
                  <details className={styles.phrases}>
                    <summary>Fix caption words ({phrases.length})</summary>
                    <ol>
                      {phrases.map((p) => (
                        <li key={`${p.index}-${transcript?.segments[p.index]?.text ?? ""}`}>
                          <span className="t-mono t-tertiary">{formatTimecode(Math.max(0, p.start - draft.start))}</span>
                          <input
                            className="input"
                            defaultValue={p.text}
                            maxLength={LIMITS.captionText}
                            aria-label={`Caption at ${formatTimecode(p.start)}`}
                            onBlur={(e) => void saveSegment(p.index, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                          />
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : (
                  <p className="field-help">Nobody speaks in this part of the video.</p>
                )}
              </>
            )}
          </section>

          <section className={styles.group} aria-labelledby={`${id}-ttl`}>
            <div className={styles.groupHead}>
              <h2 id={`${id}-ttl`} className={styles.groupTitle}>
                Title on video
              </h2>
              <input className="switch" type="checkbox" role="switch" aria-label="Show a title" checked={draft.edit.showTitle} onChange={(e) => setEdit({ showTitle: e.target.checked })} />
            </div>
            {draft.edit.showTitle ? (
              <div className="field">
                <label className="sr-only" htmlFor={`${id}-ttltext`}>
                  Title text
                </label>
                <input
                  id={`${id}-ttltext`}
                  className="input"
                  placeholder={draft.title}
                  value={draft.edit.titleText}
                  maxLength={LIMITS.overlayTitle}
                  onChange={(e) => setEdit({ titleText: e.target.value })}
                />
                <p className="field-help">Leave empty to use the clip’s name.</p>
              </div>
            ) : (
              <p className="field-help">A highlighted headline at the top of the video.</p>
            )}
          </section>

          {project.clips.length > 1 ? (
            <button className="btn btn-secondary" type="button" onClick={() => void applyToAll()}>
              <CopySimple size={18} aria-hidden /> Use this look for all clips
            </button>
          ) : null}
        </aside>
      </div>

      {watching && state.kind === "done" ? <WatchDialog src={exportUrl(project.id, clip.id, clip.export?.version, true)} aspect={draft.edit.aspect} onClose={() => setWatching(false)} /> : null}
    </main>
  );
}

/** Whether caption timing is measured from the audio, with a way to do it for older projects. */
/**
 * Caption timing: word-accurate when transcribed on this device. Older projects (and other
 * languages, transcribed by Gemini) have approximate timing; English ones can be redone here.
 */
function TranscriptStatus({ project, onRetranscribe }: { project: Project; onRetranscribe: () => void }) {
  const working = project.job.status === "transcribing" || (project.job.status === "queued" && project.job.stages?.includes("transcribing"));
  if (working) {
    const pct = Math.round(project.job.progress * 100);
    return (
      <div className={styles.sync} role="status">
        <span>{project.job.status === "queued" ? "Waiting to transcribe…" : `${project.job.message || "Transcribing on this device"} ${pct}%`}</span>
        <div className="progress" aria-hidden="true">
          <span style={{ "--value": `${Math.max(3, pct)}%` } as React.CSSProperties} />
        </div>
      </div>
    );
  }
  if (project.language === "other") return <p className="field-help">Caption timing is approximate for videos in languages other than English.</p>;
  if (!needsRetranscribe(project)) return null;
  return (
    <div className={styles.sync}>
      <span>These captions come from an earlier transcript whose timing can be off. Transcribe again on this device for word-accurate captions (caption word fixes will be replaced).</span>
      <button className="btn btn-secondary btn-sm" type="button" onClick={onRetranscribe} disabled={isJobActive(project.job.status)}>
        Transcribe again
      </button>
    </div>
  );
}

/** A window of source around the clip for the trim bar: the clip plus some context either side. */
function viewAround(start: number, end: number, duration: number) {
  const pad = Math.max(8, (end - start) * 0.6);
  return { from: Math.max(0, start - pad), to: Math.min(duration, end + pad) };
}

function ExportButton({
  state,
  busy,
  onExport,
  onWatch,
}: {
  state: ReturnType<typeof exportState>;
  busy: boolean;
  onExport: () => void;
  onWatch: () => void;
}) {
  if (state.kind === "busy") {
    const pct = Math.round(state.progress * 100);
    return (
      <div className={styles.exporting} role="status">
        <span>{state.queued ? "Waiting…" : `Exporting ${pct}%`}</span>
        <div className="progress" aria-hidden="true">
          <span style={{ "--value": `${Math.max(3, pct)}%` } as React.CSSProperties} />
        </div>
      </div>
    );
  }
  if (state.kind === "done" && !state.stale) {
    return (
      <div className={styles.exportDone}>
        <button className="btn btn-ghost btn-sm" type="button" onClick={onWatch}>
          <Play size={16} aria-hidden /> Watch
        </button>
        <a className="btn btn-volt" href={state.href} download>
          <DownloadSimple size={18} weight="bold" aria-hidden /> Download{state.bytes ? <span className={styles.size}>{formatBytes(state.bytes)}</span> : null}
        </a>
      </div>
    );
  }
  return (
    <div className={styles.exportDone}>
      {state.kind === "failed" ? (
        <span className="badge is-error" title={state.error}>
          <WarningCircle size={14} weight="fill" aria-hidden /> Export failed
        </span>
      ) : null}
      {state.kind === "done" && state.stale ? (
        <a className="btn btn-ghost btn-sm" href={state.href} download title="Download the previous export (without your latest edits)">
          <DownloadSimple size={16} aria-hidden /> Previous
        </a>
      ) : null}
      <button className="btn btn-volt" type="button" onClick={onExport} disabled={busy} aria-busy={busy}>
        <Export size={18} weight="bold" aria-hidden /> {state.kind === "none" ? "Export" : "Export again"}
      </button>
    </div>
  );
}

function WatchDialog({ src, aspect, onClose }: { src: string; aspect: ClipEdit["aspect"]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog studio ${styles.watch}`}
      aria-label="Exported clip"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <video src={src} controls autoPlay playsInline style={{ aspectRatio: aspect.replace(":", " / ") }} />
      <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Close" onClick={() => ref.current?.close()}>
        <X size={18} aria-hidden />
      </button>
    </dialog>
  );
}
