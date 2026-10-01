"use client";

import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";

/* Motion helpers for the landing page's demos. */

const reducedMotion = {
  subscribe: (cb: () => void) => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  },
  get: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

/** True when the visitor asked for less motion (false while rendering on the server). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(reducedMotion.subscribe, reducedMotion.get, () => false);
}

/**
 * Whether the element is on screen. With `once`, stays true after the first time, so a
 * demo plays its story when it's first seen and then keeps its final state.
 */
export function useInView(ref: RefObject<Element | null>, { once = false, threshold = 0.35 }: { once?: boolean; threshold?: number } = {}): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setInView(entry.isIntersecting);
        if (entry.isIntersecting && once) io.disconnect();
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, once, threshold]);
  return inView;
}

/** A counter that steps every `ms` while `running` (for word-by-word captions). */
export function useTicker(ms: number, running: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms, running]);
  return tick;
}
