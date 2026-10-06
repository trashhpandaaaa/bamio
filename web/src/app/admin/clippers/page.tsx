import type { Metadata } from "next";
import Link from "next/link";
import { clipperLink } from "@/lib/profile/clipper";
import { requireAdmin, usersById } from "@/lib/server/admin";
import { clipperQueue } from "@/lib/server/clippers";
import { PRIVATE_PAGE } from "@/lib/site";
import { ClipperActions } from "../admin-controls";
import { AdminShell } from "../admin-shell";
import { ago, when } from "../format";
import { UserLink } from "../tables";
import styles from "../admin.module.css";

export const metadata: Metadata = { title: "Clippers · Admin", robots: PRIVATE_PAGE };

const BADGE = { pending: ["is-info", "Waiting"], approved: ["is-success", "On the page"], hidden: ["", "Hidden"] } as const;

/** Who asked to be on the Clippers page: approve a card (it's public at once) or hide it. Those waiting come first. */
export default async function AdminClippersPage() {
  const admin = await requireAdmin();
  const queue = await clipperQueue();
  const users = await usersById(queue.map((c) => c.userId));
  const waiting = queue.filter((c) => c.status === "pending").length;

  return (
    <AdminShell
      admin={admin}
      title="Clippers"
      lede={
        <>
          {waiting === 0 ? "Nobody is waiting." : `${waiting} waiting for a look.`} People turn this on in their profile; a card shows on the{" "}
          <Link className={styles.cellLink} href="/clippers">
            Clippers page
          </Link>{" "}
          once approved, and comes back here whenever they change it.
        </>
      }
    >
      {queue.length === 0 ? (
        <p className={styles.note}>Nobody has asked to be listed yet.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Card</th>
                <th>Channel</th>
                <th>Account</th>
                <th>Status</th>
                <th>Changed</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {queue.map((c) => {
                const link = c.link ? clipperLink(c.link) : null;
                const [tone, label] = BADGE[c.status];
                return (
                  <tr key={c.userId}>
                    <td>
                      <span className={styles.person}>
                        <span className="avatar" aria-hidden="true">
                          {/* Their Clerk profile picture. */}
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {c.imageUrl ? <img src={c.imageUrl} alt="" width={32} height={32} loading="lazy" referrerPolicy="no-referrer" /> : c.name.slice(0, 1).toUpperCase()}
                        </span>
                        <b>{c.name}</b>
                      </span>
                      {c.bio ? <span className={styles.sub}>{c.bio}</span> : null}
                    </td>
                    <td>
                      {link ? (
                        <a className={styles.cellLink} href={link.url} target="_blank" rel="noopener noreferrer">
                          {link.url.replace("https://", "")}
                        </a>
                      ) : (
                        <span className="t-tertiary">None</span>
                      )}
                    </td>
                    <td>
                      <UserLink id={c.userId} user={users.get(c.userId)} />
                    </td>
                    <td>
                      <span className={`badge ${tone}`}>{label}</span>
                      {c.reviewedBy && c.status !== "pending" ? <span className={styles.sub}>by {c.reviewedBy}</span> : null}
                    </td>
                    <td className={styles.nowrap} title={when(c.updatedAt)}>
                      {ago(c.updatedAt)}
                    </td>
                    <td>
                      <ClipperActions userId={c.userId} name={c.name} status={c.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
