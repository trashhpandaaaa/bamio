"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { projectReducer, type ProjectAction } from "@/lib/project/ops";
import type { Project } from "@/lib/project/schema";
import { getProject, saveProject } from "@/lib/storage/db";

export type LoadState = "loading" | "ready" | "missing" | "error";
export type SaveState = "saved" | "saving" | "error";

const SAVE_DELAY_MS = 400;

function reducer(project: Project | null, action: ProjectAction): Project | null {
  if (action.type === "replace") return action.project;
  return project ? projectReducer(project, action) : null;
}

/** Load a project, edit it through the reducer, and autosave changes to IndexedDB. */
export function useProject(id: string) {
  const [project, dispatch] = useReducer(reducer, null);
  const [load, setLoad] = useState<{ state: LoadState; error?: string }>({ state: "loading" });
  const [save, setSave] = useState<SaveState>("saved");
  const saved = useRef<Project | null>(null);
  const latest = useRef<Project | null>(null);

  useEffect(() => {
    let alive = true;
    getProject(id)
      .then((p) => {
        if (!alive) return;
        if (!p) return setLoad({ state: "missing" });
        saved.current = p;
        dispatch({ type: "replace", project: p });
        setLoad({ state: "ready" });
      })
      .catch((err: unknown) => alive && setLoad({ state: "error", error: err instanceof Error ? err.message : String(err) }));
    return () => {
      alive = false;
    };
  }, [id]);

  const persist = useCallback(async (p: Project) => {
    setSave("saving");
    try {
      await saveProject(p);
      saved.current = p;
      setSave(latest.current === p ? "saved" : "saving");
    } catch {
      setSave("error");
    }
  }, []);

  // Debounced autosave whenever the project object changes.
  useEffect(() => {
    latest.current = project;
    if (!project || project === saved.current) return;
    setSave("saving");
    const timer = setTimeout(() => void persist(project), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [project, persist]);

  // Flush unsaved edits when leaving the page or closing the tab.
  useEffect(() => {
    const flush = () => {
      const p = latest.current;
      if (p && p !== saved.current) void saveProject(p).then(() => (saved.current = p)).catch(() => undefined);
    };
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, []);

  return { project, dispatch, load, save, saveNow: persist };
}
