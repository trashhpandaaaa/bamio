import Link from "next/link";
import { PLANS, type PlanId } from "@/lib/billing/plans";
import type { AdminJob, UserSummary } from "@/lib/server/admin";
import { JobActions } from "./admin-controls";
import { ago, statusTone, when } from "./format";
import styles from "./admin.module.css";

/** A user's plan: a free one given by hand, else their subscription and its state. */
export function PlanBadge({ plan, status, granted }: { plan: PlanId | null; status: string | null; granted: PlanId | null }) {
  if (granted) return <span className="badge is-success">Free {PLANS[granted].name}</span>;
  if (!plan || !PLANS[plan]) return <span className="t-tertiary">None</span>;
  const tone = status === "active" || status === "trialing" ? "is-success" : status === "past_due" ? "is-warning" : "";
  const note = status === "active" || status === "trialing" ? "" : status === "past_due" ? " · payment due" : status ? ` · ${status.replace(/_/g, " ")}` : "";
  return (
    <span className={`badge ${tone}`}>
      {PLANS[plan].name}
      {note}
    </span>
  );
}

/** A link to a user's page, by email when known. */
export function UserLink({ id, user }: { id: string; user: UserSummary | undefined }) {
  return (
    <Link className={styles.cellLink} href={`/admin/users/${encodeURIComponent(id)}`}>
      {user?.email ?? id}
    </Link>
  );
}

/** Jobs, newest first, with Retry and Cancel where they make sense. */
export function JobTable({ jobs, users, showUser = true }: { jobs: AdminJob[]; users?: Map<string, UserSummary>; showUser?: boolean }) {
  if (jobs.length === 0) return <p className={styles.note}>No jobs here.</p>;
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Job</th>
            <th>Status</th>
            {showUser ? <th>User</th> : null}
            <th>Project</th>
            <th className={styles.num}>Tries</th>
            <th>Updated</th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td className={styles.nowrap}>
                <span className={styles.mono}>#{j.id}</span>
                <span className={styles.sub}>{j.kind}</span>
              </td>
              <td>
                <span className={`badge ${statusTone(j.status)}`}>{j.status}</span>
                {j.lastError && j.status !== "done" ? <span className={styles.error}>{j.lastError.slice(0, 300)}</span> : null}
              </td>
              {showUser ? (
                <td>
                  <UserLink id={j.userId} user={users?.get(j.userId)} />
                </td>
              ) : null}
              <td>
                {j.projectTitle ?? <span className="t-tertiary">Deleted</span>}
                <span className={styles.sub}>
                  {j.projectId}
                  {j.clipId ? ` · clip ${j.clipId}` : ""}
                </span>
              </td>
              <td className={styles.num}>
                {j.attempts}/{j.maxAttempts}
              </td>
              <td className={styles.nowrap} title={when(j.updatedAt)}>
                {ago(j.updatedAt)}
                <span className={styles.sub}>made {ago(j.createdAt)}</span>
              </td>
              <td>
                <JobActions
                  jobId={j.id}
                  kind={j.kind}
                  canRetry={(j.status === "failed" || j.status === "cancelled") && j.latest && j.projectTitle !== null}
                  canCancel={(j.status === "queued" || j.status === "running") && j.kind !== "finish-follow"}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
