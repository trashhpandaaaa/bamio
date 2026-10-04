import type { ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import type { Admin } from "@/lib/server/admin";
import { AdminNav } from "./admin-nav";
import styles from "./admin.module.css";

/** Every admin page: the app header, the page's title, the section tabs. */
export function AdminShell({ admin, title, lede, children }: { admin: Admin; title: string; lede?: ReactNode; children: ReactNode }) {
  return (
    <>
      <AppHeader />
      <main id="main" className={`container ${styles.page}`}>
        <div className={styles.head}>
          <span className={styles.kicker}>Admin · {admin.role === "superadmin" ? "Superadmin" : "Admin"}</span>
          <h1>{title}</h1>
          {lede ? <p>{lede}</p> : null}
        </div>
        <AdminNav superadmin={admin.role === "superadmin"} />
        {children}
      </main>
    </>
  );
}
