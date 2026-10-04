import type { Metadata } from "next";
import { adminActions, adminList, requireAdmin } from "@/lib/server/admin";
import { PRIVATE_PAGE } from "@/lib/site";
import { AddAdminForm, RemoveAdminButton } from "../admin-controls";
import { AdminShell } from "../admin-shell";
import { ago, when } from "../format";
import styles from "../admin.module.css";

export const metadata: Metadata = { title: "Admins · Admin", robots: PRIVATE_PAGE };

/** Who can open the panel (superadmins only), and everything changed from it. */
export default async function AdminAdminsPage() {
  const admin = await requireAdmin("superadmin");
  const [{ superadmins, admins }, actions] = await Promise.all([adminList(), adminActions(100)]);

  return (
    <AdminShell admin={admin} title="Admins" lede="Superadmins are set on the server (BAMIO_SUPERADMINS in web/.env). Admins are added here.">
      <div className={styles.panels}>
        <section className={styles.panel} aria-labelledby="supers">
          <h2 id="supers" className={styles.kicker}>
            Superadmins
          </h2>
          <ul className={styles.plainList}>
            {superadmins.map((email) => (
              <li key={email}>{email}</li>
            ))}
          </ul>
          <p className="t-tertiary">Everything admins can do, and give plans and manage admins.</p>
        </section>
        <section className={styles.panel} aria-labelledby="add">
          <h2 id="add" className={styles.kicker}>
            New admin
          </h2>
          <AddAdminForm />
        </section>
      </div>

      <section className={styles.section} aria-labelledby="admins">
        <h2 id="admins">Admins</h2>
        {admins.length === 0 ? (
          <p className={styles.note}>No admins yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Admin</th>
                  <th>Added by</th>
                  <th>Since</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.user_id}>
                    <td>
                      {a.email}
                      <span className={styles.sub}>{a.user_id}</span>
                    </td>
                    <td>{a.added_by}</td>
                    <td className={styles.nowrap}>{when(a.created_at).slice(0, 10)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <RemoveAdminButton userId={a.user_id} email={a.email} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="log">
        <h2 id="log">Changes made here</h2>
        {actions.length === 0 ? (
          <p className={styles.note}>Nothing changed from the panel yet.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id}>
                    <td className={styles.nowrap} title={when(a.at)}>
                      {ago(a.at)}
                    </td>
                    <td>{a.admin_email}</td>
                    <td>
                      <span className={styles.mono}>{a.action}</span>
                      {a.target ? <span className={styles.sub}>{a.target}</span> : null}
                    </td>
                    <td className={styles.mono}>{JSON.stringify(a.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
