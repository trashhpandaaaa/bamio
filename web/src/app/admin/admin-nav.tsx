"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./admin.module.css";

const SECTIONS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/jobs", label: "Jobs and errors" },
  { href: "/admin/money", label: "Money" },
];

/** The panel's sections; Admins only for superadmins. */
export function AdminNav({ superadmin }: { superadmin: boolean }) {
  const pathname = usePathname();
  const sections = superadmin ? [...SECTIONS, { href: "/admin/admins", label: "Admins" }] : SECTIONS;
  return (
    <nav className={styles.nav} aria-label="Admin">
      {sections.map((s) => {
        const current = s.href === "/admin" ? pathname === "/admin" : pathname === s.href || pathname.startsWith(`${s.href}/`);
        return (
          <Link key={s.href} href={s.href} className={styles.navLink} aria-current={current ? "page" : undefined}>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
