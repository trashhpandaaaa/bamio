import type { Metadata } from "next";
import Link from "next/link";
import { jobList, recentEmails, requireAdmin, usersById, type JobView } from "@/lib/server/admin";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "../admin-shell";
import { ago, statusTone, when } from "../format";
import { JobTable, UserLink } from "../tables";
import styles from "../admin.module.css";

export const metadata: Metadata = { title: "Jobs and errors · Admin", robots: PRIVATE_PAGE };

const VIEWS = [
  { id: "active", label: "Running and waiting" },
  { id: "failed", label: "Failed (7 days)" },
  { id: "recent", label: "All recent" },
  { id: "emails", label: "Emails" },
] as const;
type View = (typeof VIEWS)[number]["id"];

/** The queue: what's running, what failed and why (retry or cancel), and the emails going out. */
export default async function AdminJobsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const view: View = VIEWS.some((v) => v.id === params.view) ? (params.view as View) : "active";

  return (
    <AdminShell admin={admin} title="Jobs and errors" lede="Retry runs a failed job again the way its owner would. Cancel stops it and shows its owner it failed.">
      <nav className={`seg ${styles.segNav}`} aria-label="Show">
        {VIEWS.map((v) => (
          <Link key={v.id} href={`/admin/jobs?view=${v.id}`} className={styles.segLink} aria-current={v.id === view ? "page" : undefined}>
            {v.label}
          </Link>
        ))}
      </nav>
      {view === "emails" ? <EmailTable /> : <Jobs view={view} />}
    </AdminShell>
  );
}

async function Jobs({ view }: { view: JobView }) {
  const jobs = await jobList(view);
  const users = await usersById(jobs.map((j) => j.userId));
  return <JobTable jobs={jobs} users={users} />;
}

async function EmailTable() {
  const emails = await recentEmails(60);
  if (emails.length === 0) return <p className={styles.note}>No emails yet.</p>;
  const users = await usersById(emails.map((e) => e.user_id));
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Email</th>
            <th>To</th>
            <th>Status</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {emails.map((e) => (
            <tr key={e.id}>
              <td>
                {e.subject ?? e.template}
                <span className={styles.sub}>{e.template}</span>
              </td>
              <td>
                <UserLink id={e.user_id} user={users.get(e.user_id)} />
              </td>
              <td>
                <span className={`badge ${statusTone(e.status)}`}>{e.status}</span>
                {e.last_error ? <span className={styles.error}>{e.last_error.slice(0, 300)}</span> : null}
              </td>
              <td className={styles.nowrap} title={when(e.updated_at)}>
                {ago(e.updated_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
