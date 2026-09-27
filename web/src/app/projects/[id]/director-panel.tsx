"use client";

import { ArrowClockwise, Check, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type Dispatch } from "react";
import { AiMark } from "@/components/brand";
import { useToast } from "@/components/toast";
import { useAiStatus } from "@/hooks/use-ai-status";
import { aiClient, errorMessage, isAbort } from "@/lib/ai/client";
import { notesFromDirector, selectedHook, type ProjectAction } from "@/lib/project/ops";
import type { DirectorNote, Project } from "@/lib/project/schema";
import styles from "./director.module.css";

const SEVERITY = {
  fix: { label: "Fix", badge: "badge is-error" },
  improve: { label: "Improve", badge: "badge is-warning" },
  polish: { label: "Polish", badge: "badge" },
} as const;
const ORDER = { fix: 0, improve: 1, polish: 2 } as const;

type Props = { project: Project; dispatch: Dispatch<ProjectAction>; onOpenTab: (tab: "storyboard" | "edit") => void };

function describeAction(note: DirectorNote, project: Project): string | null {
  const a = note.action;
  if (!a) return null;
  const n = project.scenes.findIndex((s) => s.id === a.sceneId) + 1;
  switch (a.kind) {
    case "caption":
      return `Scene ${n} caption → “${a.value}”`;
    case "voiceover":
      return `Scene ${n} voice-over → “${a.value}”`;
    case "duration":
      return `Scene ${n} length → ${a.value} s`;
    case "hook":
      return `Hook → “${a.value}”`;
  }
}

export function DirectorPanel({ project, dispatch, onOpenTab }: Props) {
  const { status } = useAiStatus();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  async function getNotes() {
    controller.current?.abort();
    controller.current = new AbortController();
    setLoading(true);
    setError(null);
    try {
      const out = await aiClient.director(
        {
          brief: project.brief,
          hook: selectedHook(project)?.text ?? "",
          scenes: project.scenes.map((s) => ({
            durationSec: s.durationSec,
            voiceover: s.voiceover,
            caption: s.caption,
            visual: s.visual,
            shot: s.shot,
            hasImage: Boolean(s.imageId),
          })),
        },
        controller.current.signal,
      );
      dispatch({ type: "setNotes", summary: out.summary, notes: notesFromDirector(project, out) });
    } catch (err) {
      if (!isAbort(err)) setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  const visible = project.notes.filter((n) => n.status !== "dismissed").sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  const hasNotes = project.notes.length > 0;
  const aiReady = status?.configured ?? true;

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <div>
          <h2 className="t-heading-lg">Notes from your AI director</h2>
          <p className="t-secondary">A review of the hook, the pacing and the captions, with changes you can apply in one click.</p>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => void getNotes()} disabled={loading || !aiReady} aria-busy={loading}>
          {loading ? null : hasNotes ? <ArrowClockwise size={18} aria-hidden /> : null}
          {loading ? "Reviewing the cut…" : hasNotes ? "Get fresh notes" : "Get notes"}
        </button>
      </div>

      {!aiReady ? (
        <div className="notice is-warning" role="status">
          <WarningCircle size={20} aria-hidden />
          <p>Add GEMINI_API_KEY to web/.env.local and restart the server to get notes.</p>
        </div>
      ) : null}

      {error ? (
        <div className="notice is-error" role="alert">
          <WarningCircle size={20} aria-hidden />
          <p>{error}</p>
        </div>
      ) : null}

      {loading && !hasNotes ? (
        <div className={styles.list} aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton" style={{ height: 112, borderRadius: "var(--r-lg)" }} />
          ))}
        </div>
      ) : null}

      {project.directorSummary ? (
        <p className={styles.summary}>
          <AiMark size={18} />
          {project.directorSummary}
        </p>
      ) : null}

      {hasNotes ? (
        <ul className={styles.list} aria-label="Director notes">
          {visible.map((note) => {
            const change = describeAction(note, project);
            const applied = note.status === "applied";
            return (
              <li key={note.id} className={styles.note} data-applied={applied}>
                <div className={styles.noteHead}>
                  <span className={SEVERITY[note.severity].badge}>{SEVERITY[note.severity].label}</span>
                  <strong>{note.title}</strong>
                </div>
                {note.body ? <p>{note.body}</p> : null}
                {change ? <p className={styles.change}>{change}</p> : null}
                <div className={styles.noteActions}>
                  {applied ? (
                    <span className="badge is-success">
                      <Check size={14} aria-hidden />
                      Applied
                    </span>
                  ) : (
                    <>
                      {note.action ? (
                        <button
                          className="btn btn-primary btn-sm"
                          type="button"
                          onClick={() => {
                            dispatch({ type: "applyNote", id: note.id });
                            toast({ tone: "success", title: "Note applied", body: change ?? undefined });
                          }}
                        >
                          Apply
                        </button>
                      ) : (
                        <button className="btn btn-secondary btn-sm" type="button" onClick={() => onOpenTab("storyboard")}>
                          Open storyboard
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => dispatch({ type: "dismissNote", id: note.id })}>
                        Dismiss
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {hasNotes && visible.length === 0 ? <p className="t-secondary">All notes dismissed. Get fresh notes after your next round of edits.</p> : null}
    </div>
  );
}
