"use client";

import { Plus, Scissors, Trash, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { JobSteps } from "@/components/job-steps";
import { PlatformIcon } from "@/components/platform-icon";
import { useToast } from "@/components/toast";
import { useProjects } from "@/hooks/use-project";
import { api, thumbUrl } from "@/lib/clips/api";
import { formatAgo, JOB_LABEL } from "@/lib/clips/labels";
import { formatTimecode } from "@/lib/clips/logic";
import { isJobActive, type Project } from "@/lib/clips/schema";
import { PLATFORM_LABEL } from "@/lib/clips/url";
import styles from "./projects.module.css";

export function ProjectsView() {
  const { projects, error, refresh, setProjects } = useProjects();
  const toast = useToast();
  const [deleting, setDeleting] = useState<Project | null>(null);

  async function remove(project: Project) {
    try {
      await api.deleteProject(project.id);
      setProjects((projects ?? []).filter((p) => p.id !== project.id));
      toast({ tone: "success", title: "Project deleted" });
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t delete the project", body: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <main id="main" className={`container ${styles.page}`}>
      <div className={styles.head}>
        <div>
          <h1 className="t-heading-xl">Projects</h1>
          <p className="t-secondary">Every video you import, with the clips cut from it.</p>
        </div>
        <Link href="/new" className="btn btn-volt">
          <Plus size={18} weight="bold" aria-hidden />
          Import a video
        </Link>
      </div>

      {error && !projects ? (
        <div className="notice is-error" role="alert">
          <WarningCircle size={20} weight="fill" aria-hidden />
          <div>
            <strong>Couldn’t load your projects</strong>
            <p>{error.message}</p>
          </div>
          <button className="btn btn-secondary btn-sm" type="button" onClick={refresh} style={{ marginLeft: "auto" }}>
            Try again
          </button>
        </div>
      ) : null}

      {!projects && !error ? (
        <ul className={styles.grid} aria-busy="true" aria-label="Loading projects">
          {[0, 1, 2].map((i) => (
            <li key={i} className={styles.cardSkeleton}>
              <div className="skeleton" style={{ aspectRatio: "16 / 9", borderRadius: "var(--r-md)" }} />
              <div className="skeleton" style={{ height: 18, width: "70%" }} />
            </li>
          ))}
        </ul>
      ) : null}

      {projects && projects.length === 0 ? (
        <div className="empty">
          <Scissors size={40} aria-hidden />
          <h2 className="empty-title">No projects yet</h2>
          <p className="empty-body">Paste a YouTube, Twitch or Kick link, or upload a video. Bamio finds the moments worth posting.</p>
          <Link href="/new" className="btn btn-primary">
            Import your first video
          </Link>
        </div>
      ) : null}

      {projects && projects.length > 0 ? (
        <ul className={styles.grid} aria-label="Your projects">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onDelete={() => setDeleting(p)} />
          ))}
        </ul>
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this project?"
        body={`“${deleting?.title ?? ""}” and all of its clips and exports will be deleted. This can’t be undone.`}
        confirmLabel="Delete project"
        destructive
        onConfirm={() => deleting && void remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </main>
  );
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const prepared = project.source.width > 0;
  const active = isJobActive(project.job.status);
  const failed = project.job.status === "failed";
  const exported = project.clips.filter((c) => c.export?.status === "done").length;

  return (
    <li className={styles.card}>
      <Link href={`/projects/${project.id}`} className={styles.link}>
        <div className={styles.thumb}>
          {prepared ? (
            // Served by our own API with auth cookies; next/image can't optimise it.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbUrl(project.id)} alt="" loading="lazy" />
          ) : (
            <span className={styles.placeholder}>
              <PlatformIcon platform={project.source.platform} size={34} />
            </span>
          )}
          {project.source.durationSec > 0 ? <span className={styles.dur}>{formatTimecode(project.source.durationSec)}</span> : null}
          {active ? (
            <span className={`studio ${styles.overlay}`}>
              <JobSteps project={project} compact />
            </span>
          ) : null}
        </div>
        <h2 className="card-title">{project.title}</h2>
      </Link>
      <p className="card-meta">
        {failed ? (
          <span className="badge is-error">
            <WarningCircle size={14} weight="fill" aria-hidden />
            {JOB_LABEL.failed}
          </span>
        ) : active ? (
          <span className="badge is-info">{JOB_LABEL[project.job.status]}</span>
        ) : (
          <span className="badge">
            {project.clips.length} {project.clips.length === 1 ? "clip" : "clips"}
            {exported > 0 ? `, ${exported} exported` : ""}
          </span>
        )}
        <span>
          <PlatformIcon platform={project.source.platform} size={13} style={{ verticalAlign: "-2px" }} /> {PLATFORM_LABEL[project.source.platform]}
        </span>
        <span>{formatAgo(project.updatedAt)}</span>
      </p>
      <button className={`btn btn-ghost btn-icon btn-sm ${styles.delete}`} type="button" aria-label={`Delete ${project.title}`} onClick={onDelete}>
        <Trash size={16} aria-hidden />
      </button>
    </li>
  );
}
