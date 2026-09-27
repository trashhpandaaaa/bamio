import { Wordmark } from "@/components/brand";
import styles from "./auth-shell.module.css";

/** Frame for the sign-in and sign-up pages. */
export function AuthShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main id="main" className={styles.shell}>
      <div className={styles.brand}>
        <Wordmark />
        <p className={styles.title}>{title}</p>
      </div>
      {children}
    </main>
  );
}
