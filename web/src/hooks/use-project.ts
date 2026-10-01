"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/clips/api";
import { isFollowing, isJobActive, type Project, type SystemStatus, type Transcript } from "@/lib/clips/schema";

/** True while the server is working on the project (import, analysis, an export, or a followed stream growing). */
export function isBusy(project: Project): boolean {
  return (
    isJobActive(project.job.status) || isFollowing(project) || project.clips.some((c) => c.export?.status === "queued" || c.export?.status === "rendering")
  );
}

/**
 * Load a resource and keep polling it while `shouldPoll` says so. Also refreshes when
 * the tab becomes visible again. `set` lets callers apply a fresher copy from a mutation.
 */
function usePolled<T>(load: (signal: AbortSignal) => Promise<T>, shouldPoll: (value: T) => boolean, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  const loadRef = useRef(load);
  const pollRef = useRef(shouldPoll);
  useEffect(() => {
    loadRef.current = load;
    pollRef.current = shouldPoll;
  });

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    loadRef
      .current(controller.signal)
      .then((value) => {
        setData(value);
        setError(null);
        if (pollRef.current(value)) timer = setTimeout(() => setTick((t) => t + 1), intervalMs);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        const apiError = err instanceof ApiError ? err : new ApiError(0, "error", "Something went wrong. Try again.");
        setError(apiError);
        // Keep trying through brief network trouble, but not after a 4xx.
        if (apiError.status === 0 || apiError.status >= 500) timer = setTimeout(() => setTick((t) => t + 1), intervalMs * 3);
      });
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [tick, intervalMs]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const set = useCallback((value: T) => {
    setData(value);
    setTick((t) => t + 1);
  }, []);
  return { data, error, refresh, set };
}

export function useProject(id: string) {
  const { data, error, refresh, set } = usePolled((signal) => api.project(id, signal), isBusy, 1000);
  return { project: data, error, refresh, setProject: set };
}

export function useProjects() {
  const { data, error, refresh, set } = usePolled((signal) => api.projects(signal), (list) => list.some(isBusy), 2000);
  return { projects: data, error, refresh, setProjects: set };
}

/** The transcript, reloaded whenever its revision changes (`rev`: anything that changes with it, e.g. "3:1260.5" for a growing one). */
export function useTranscript(id: string, enabled: boolean, rev: number | string) {
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    api
      .transcript(id, controller.signal)
      .then(setTranscript)
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, enabled, rev]);
  return { transcript: enabled ? transcript : null, setTranscript };
}

let statusPromise: Promise<SystemStatus | null> | null = null;

/** What this server can do (link import, AI). Fetched once per page load. */
export function useSystemStatus() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  useEffect(() => {
    let live = true;
    statusPromise ??= api.status().catch(() => {
      statusPromise = null;
      return null;
    });
    void statusPromise.then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return status;
}
