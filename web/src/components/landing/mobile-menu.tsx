"use client";

import { List, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./mobile-menu.module.css";

/**
 * The marketing pages' links on small screens: a menu button and a native popover (closes
 * on Escape, a tap outside, or picking a link). Hidden from 900px, where the links are in
 * the bar.
 */
export function MobileMenu({ children }: { children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const onToggle = (e: Event) => setOpen((e as ToggleEvent).newState === "open");
    el.addEventListener("toggle", onToggle);
    return () => el.removeEventListener("toggle", onToggle);
  }, []);

  return (
    <>
      <button
        className={`btn btn-ghost btn-icon btn-sm ${styles.button}`}
        type="button"
        popoverTarget="site-menu"
        aria-label={open ? "Close the menu" : "Open the menu"}
        aria-expanded={open}
        aria-controls="site-menu"
      >
        {open ? <X size={20} aria-hidden /> : <List size={20} aria-hidden />}
      </button>
      <div
        ref={panel}
        id="site-menu"
        popover="auto"
        className={styles.panel}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("a")) panel.current?.hidePopover();
        }}
      >
        <nav aria-label="Sections">{children}</nav>
      </div>
    </>
  );
}
