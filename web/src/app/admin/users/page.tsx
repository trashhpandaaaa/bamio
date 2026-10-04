import { MagnifyingGlass } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin, searchUsers, userRows } from "@/lib/server/admin";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "../admin-shell";
import { ago, count, when } from "../format";
import { PlanBadge } from "../tables";
import styles from "../admin.module.css";

export const metadata: Metadata = { title: "Users · Admin", robots: PRIVATE_PAGE };

const PER_PAGE = 25;

/** Everyone with an account, newest first; ?q= searches emails and names. */
export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 200) : "";
  const page = Math.max(0, Math.min(1000, Number(params.page) || 0));
  const { users, total } = await searchUsers(q, page, PER_PAGE);
  const rows = await userRows(users);
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const href = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), ...(p > 0 ? { page: String(p) } : {}) })}`;

  return (
    <AdminShell admin={admin} title="Users" lede={`${count(total)} ${q ? "matching" : "in all"}. Open someone to see their projects, plan and emails.`}>
      <form className={styles.search} action="/admin/users" role="search">
        <div className="input-wrap">
          <MagnifyingGlass aria-hidden />
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Email, name or username" aria-label="Search users" />
        </div>
        <button className="btn btn-secondary" type="submit">
          Search
        </button>
      </form>
      {rows.length === 0 ? (
        <p className={styles.note}>{q ? "No one matches that." : "No users yet."}</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>User</th>
                <th>Plan</th>
                <th className={styles.num}>Projects</th>
                <th className={styles.num}>Minutes this month</th>
                <th>Joined</th>
                <th>Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id}>
                  <td>
                    <Link className={styles.cellLink} href={`/admin/users/${encodeURIComponent(u.id)}`}>
                      {u.email ?? u.id}
                    </Link>
                    {u.name ? <span className={styles.sub}>{u.name}</span> : null}
                  </td>
                  <td>
                    <PlanBadge plan={u.plan} status={u.status} granted={u.granted} />
                  </td>
                  <td className={styles.num}>{count(u.projects)}</td>
                  <td className={styles.num}>{count(u.minutesMonth)}</td>
                  <td className={styles.nowrap} title={when(u.createdAt)}>
                    {ago(u.createdAt)}
                  </td>
                  <td className={styles.nowrap} title={when(u.lastActiveAt)}>
                    {ago(u.lastActiveAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <nav className={styles.pager} aria-label="Pages">
          {page > 0 ? (
            <Link className="btn btn-secondary btn-sm" href={href(page - 1)}>
              Newer
            </Link>
          ) : null}
          <span>
            Page {page + 1} of {pages}
          </span>
          {page + 1 < pages ? (
            <Link className="btn btn-secondary btn-sm" href={href(page + 1)}>
              Older
            </Link>
          ) : null}
        </nav>
      ) : null}
    </AdminShell>
  );
}
