"use client";

import { Check, CopySimple, Plus, Trash } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AiMark } from "@/components/brand";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SceneThumb } from "@/components/scene-thumb";
import { useToast } from "@/components/toast";
import type { Project } from "@/lib/project/schema";
import { TEMPLATES } from "@/lib/project/templates";
import { buildTimeline, formatDuration } from "@/lib/project/timeline";
import { deleteProject, duplicateProject, listProjects } from "@/lib/storage/db";
import styles from "./projects.module.css";

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
function edited(at: number): string {
  const diff = (at - Date.now()) / 1000;
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) if (Math.abs(diff) >= secs) return `Edited ${relative.format(Math.round(diff / secs), unit)}`;
  return "Edited just now";
}

type State = { status: "loading" } | { status: "ready"; projects: Project[] } | { status: "error"; message: string };

export function ProjectsView() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null);
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setState({ status: "ready", projects: await listProjects() });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Couldn’t load your videos." });
    }
  }, []);

  useEffect(() => {
    let alive = true;
    listProjects()
      .then((projects) => alive && setState({ status: "ready", projects }))
      .catch((err: unknown) => alive && setState({ status: "error", message: err instanceof Error ? err.message : "Couldn’t load your videos." }));
    return () => {
      alive = false;
    };
  }, []);

  async function onDuplicate(p: Project) {
    try {
      await duplicateProject(p.id);
      toast({ tone: "success", title: "Video duplicated", body: `“${p.title}” was copied with all its media.` });
      await refresh();
    } catch {
      toast({ tone: "error", title: "Couldn’t duplicate the video", body: "Try again. If it keeps failing, free up some disk space." });
    }
  }

  async function onDelete(p: Project) {
    try {
      await deleteProject(p.id);
      toast({ tone: "success", title: "Video deleted" });
      await refresh();
    } catch {
      toast({ tone: "error", title: "Couldn’t delete the video", body: "Try again." });
    }
  }

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.head}>
        <h1 className="t-heading-xl">Your videos</h1>
        <Link href="/new" className="btn btn-volt">
          <Plus size={18} weight="bold" aria-hidden />
          Make a video
        </Link>
      </div>

      <section aria-label="Start from a template" className={styles.templates}>
        <span className="t-label t-secondary">Start from a template</span>
        <div className={styles.templateRow}>
          {TEMPLATES.map((t) => (
            <Link key={t.id} href={`/new?template=${t.id}`} className="chip">
              {t.label}
            </Link>
          ))}
        </div>
      </section>

      {state.status === "loading" ? (
        <div className={styles.grid} aria-busy="true" aria-label="Loading your videos">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={styles.skeletonCard} aria-hidden="true">
              <div className="skeleton" />
              <div className="skeleton" style={{ height: 16, width: "75%" }} />
              <div className="skeleton" style={{ height: 12, width: "45%" }} />
            </div>
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="notice is-error" role="alert">
          <p>
            <strong>Couldn’t load your videos</strong>
            {state.message}
          </p>
        </div>
      ) : null}

      {state.status === "ready" && state.projects.length === 0 ? (
        <div className="empty">
          <AiMark size={44} />
          <p className="empty-title">Nothing here yet.</p>
          <p className="empty-body">Drop in an idea, a link or a rough clip and we’ll find the hook.</p>
          <Link href="/new" className="btn btn-volt">
            <Plus size={18} weight="bold" aria-hidden />
            Make a video
          </Link>
        </div>
      ) : null}

      {state.status === "ready" && state.projects.length > 0 ? (
        <ul className={styles.grid} aria-label="Videos">
          {state.projects.map((p) => {
            const first = p.scenes[0];
            const total = buildTimeline(p).total;
            return (
              <li key={p.id} className={styles.card}>
                <Link href={`/projects/${p.id}`} className="card-project">
                  <div className="thumb">
                    {first ? <SceneThumb scene={first} index={0} /> : null}
                    <span className="dur">{formatDuration(total)}</span>
                  </div>
                  <p className="card-title">{p.title}</p>
                </Link>
                <div className={styles.cardFoot}>
                  <p className="card-meta">
                    {p.lastExport ? (
                      <span className="badge is-success">
                        <Check size={14} aria-hidden />
                        Exported
                      </span>
                    ) : (
                      <span className="badge">Draft</span>
                    )}
                    {edited(p.updatedAt)}
                  </p>
                  <div className={styles.cardActions}>
                    <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Duplicate ${p.title}`} title="Duplicate" onClick={() => void onDuplicate(p)}>
                      <CopySimple size={16} aria-hidden />
                    </button>
                    <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Delete ${p.title}`} title="Delete" onClick={() => setPendingDelete(p)}>
                      <Trash size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.title ?? ""}”?`}
        body="The video, its pictures and its voice-over are removed from this browser. This can’t be undone."
        confirmLabel="Delete video"
        cancelLabel="Keep it"
        destructive
        onConfirm={() => pendingDelete && void onDelete(pendingDelete)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
