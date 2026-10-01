"use client";

import { useEffect, useState } from "react";
import { LinkForm } from "./link-form";
import styles from "./sticky-link-bar.module.css";

/**
 * The link form, kept at the bottom of the screen once the hero's form has scrolled away,
 * until the closing panel (which has its own) comes into view. Hidden, it's inert.
 */
export function StickyLinkBar({ after, until }: { after: string; until: string }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const start = document.getElementById(after);
    const end = document.getElementById(until);
    if (!start || !end) return;
    let past = false;
    let reached = false;
    const pastStart = new IntersectionObserver(([e]) => {
      if (!e) return;
      past = !e.isIntersecting && e.boundingClientRect.top < 0;
      setShow(past && !reached);
    });
    const reachedEnd = new IntersectionObserver(([e]) => {
      if (!e) return;
      reached = e.isIntersecting || e.boundingClientRect.top < 0;
      setShow(past && !reached);
    });
    pastStart.observe(start);
    reachedEnd.observe(end);
    return () => {
      pastStart.disconnect();
      reachedEnd.disconnect();
    };
  }, [after, until]);

  return (
    <div className={styles.bar} data-show={show ? "" : undefined} inert={!show}>
      <LinkForm variant="bar" />
    </div>
  );
}
