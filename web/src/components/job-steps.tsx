import { Check } from "@phosphor-icons/react";
import { JOB_LABEL } from "@/lib/clips/labels";
import type { JobStatus, Project } from "@/lib/clips/schema";
import styles from "./job-steps.module.css";

/** The stages this run goes through, in order: as planned by the server, or a best guess for older projects. */
export function jobStages(project: Project): JobStatus[] {
  if (project.job.stages?.length) return project.job.stages;
  const first: JobStatus = project.source.kind === "url" ? "downloading" : "uploading";
  const prepared = project.source.width > 0;
  const stages: JobStatus[] = prepared ? [] : [first, "preparing"];
  if (!project.hasTranscript || project.job.status === "transcribing") stages.push("transcribing");
  if (project.findClips) stages.push("finding");
  return stages;
}

/** Stepper plus a progress bar for the running stage. `compact` drops the stepper. */
export function JobSteps({ project, compact = false }: { project: Project; compact?: boolean }) {
  const stages = jobStages(project);
  const status = project.job.status;
  const current = status === "queued" ? -1 : stages.indexOf(status);
  const pct = Math.round(project.job.progress * 100);
  const label = status === "queued" ? "Waiting for a free slot" : project.job.message || JOB_LABEL[status];

  return (
    <div className={styles.wrap}>
      <ol className={styles.steps} hidden={compact}>
        {stages.map((stage, i) => {
          const state = i < current ? "done" : i === current ? "active" : "todo";
          return (
            <li key={stage} className={styles.step} data-state={state} aria-current={state === "active" ? "step" : undefined}>
              <span className={styles.dot} aria-hidden="true">
                {state === "done" ? <Check size={12} weight="bold" /> : i + 1}
              </span>
              {JOB_LABEL[stage]}
            </li>
          );
        })}
      </ol>
      <div className={styles.now}>
        <p className={styles.message} aria-live="polite">
          {label}
          {status !== "queued" && pct > 0 ? <span className="t-mono t-tertiary"> {pct}%</span> : null}
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={status === "queued" ? undefined : pct}
          data-indeterminate={status === "queued" || (pct === 0 && status !== "uploading") ? "" : undefined}
        >
          <span style={{ "--value": `${Math.max(pct, 2)}%` } as React.CSSProperties} />
        </div>
      </div>
    </div>
  );
}
