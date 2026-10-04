import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatPrice, PLANS } from "@/lib/billing/plans";
import { requireAdmin, userById, userExtras, userJobs, userProjects, userRows, usersById } from "@/lib/server/admin";
import { PRIVATE_PAGE } from "@/lib/site";
import { PlanGrantControl } from "../../admin-controls";
import { AdminShell } from "../../admin-shell";
import { ago, count, length, statusTone, when } from "../../format";
import { JobTable, PlanBadge, UserLink } from "../../tables";
import styles from "../../admin.module.css";

export const metadata: Metadata = { title: "User · Admin", robots: PRIVATE_PAGE };

/** One user: who they are, their plan (superadmins can give one), referrals, projects, jobs and emails. */
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  const user = await userById(id);
  if (!user) notFound();
  const [[row], projects, extras, jobs] = await Promise.all([userRows([user]), userProjects(user.id), userExtras(user.id), userJobs(user.id)]);
  const referrer = extras.referredBy ? await usersById([extras.referredBy.referrer_user_id]) : null;

  return (
    <AdminShell admin={admin} title={user.email ?? user.id} lede={user.name ?? undefined}>
      <div className={styles.panels}>
        <section className={styles.panel} aria-labelledby="who">
          <h2 id="who" className={styles.kicker}>
            Account
          </h2>
          <dl className={styles.facts}>
            <dt>User id</dt>
            <dd className={styles.mono}>{user.id}</dd>
            <dt>Joined</dt>
            <dd>{when(user.createdAt)}</dd>
            <dt>Last active</dt>
            <dd>{ago(user.lastActiveAt)}</dd>
            <dt>Projects</dt>
            <dd>{count(projects.length)}</dd>
            <dt>Minutes</dt>
            <dd>{count(row?.minutesMonth ?? 0)} this month</dd>
          </dl>
        </section>
        <section className={styles.panel} aria-labelledby="plan">
          <h2 id="plan" className={styles.kicker}>
            Plan
          </h2>
          <dl className={styles.facts}>
            <dt>Paid</dt>
            <dd>{row ? <PlanBadge plan={row.plan} status={row.status} granted={null} /> : "None"}</dd>
            <dt>Free</dt>
            <dd>{extras.grant ? `${PLANS[extras.grant.plan]?.name ?? extras.grant.plan} since ${when(extras.grant.created_at).slice(0, 10)}` : "None"}</dd>
          </dl>
          {admin.role === "superadmin" ? <PlanGrantControl userId={user.id} granted={extras.grant?.plan ?? null} /> : null}
        </section>
        <section className={styles.panel} aria-labelledby="refer">
          <h2 id="refer" className={styles.kicker}>
            Referrals
          </h2>
          <dl className={styles.facts}>
            <dt>Friends</dt>
            <dd>
              {count(extras.referrals.rewarded)} paid · {count(extras.referrals.pending)} not yet
            </dd>
            <dt>Earned</dt>
            <dd>{formatPrice(extras.referrals.cents)} of credit</dd>
            <dt>Came from</dt>
            <dd>{extras.referredBy ? <UserLink id={extras.referredBy.referrer_user_id} user={referrer?.get(extras.referredBy.referrer_user_id)} /> : "No one"}</dd>
          </dl>
        </section>
      </div>

      <section className={styles.section} aria-labelledby="projects">
        <h2 id="projects">Projects</h2>
        {projects.length === 0 ? (
          <p className={styles.note}>No projects.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Status</th>
                  <th className={styles.num}>Length</th>
                  <th className={styles.num}>Clips</th>
                  <th className={styles.num}>Exported</th>
                  <th>Made</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.title}
                      <span className={styles.sub}>
                        {p.live ? "Live · " : ""}
                        {p.url ?? p.sourceKind} · {p.id}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${statusTone(p.status)}`}>{p.status}</span>
                      {p.error ? <span className={styles.error}>{p.error.slice(0, 300)}</span> : null}
                    </td>
                    <td className={styles.num}>{p.durationSec ? length(p.durationSec) : "—"}</td>
                    <td className={styles.num}>{count(p.clips)}</td>
                    <td className={styles.num}>{count(p.exports)}</td>
                    <td className={styles.nowrap} title={when(p.createdAt)}>
                      {ago(p.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="jobs">
        <h2 id="jobs">Jobs</h2>
        <JobTable jobs={jobs.slice(0, 50)} showUser={false} />
      </section>

      <section className={styles.section} aria-labelledby="emails">
        <h2 id="emails">Emails</h2>
        {extras.emails.length === 0 ? (
          <p className={styles.note}>No emails yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {extras.emails.map((e, i) => (
                  <tr key={i}>
                    <td>
                      {e.subject ?? e.template}
                      <span className={styles.sub}>{e.template}</span>
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
        )}
      </section>
      <p className={styles.pager}>
        <Link className="btn btn-secondary btn-sm" href="/admin/users">
          All users
        </Link>
      </p>
    </AdminShell>
  );
}
