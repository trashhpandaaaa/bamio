"use client";

import { CheckCircle, DownloadSimple, LockSimple, Warning } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { exportEdit, ExportError, exportSize, exportSupport, type ExportFps, type ExportHeight, type ExportResult } from "@/lib/editor/export";
import { can } from "@/lib/editor/features";
import { clock } from "@/lib/editor/model";
import { exportProblem, totalDuration } from "@/lib/editor/timeline";
import { useEditor } from "./context";
import styles from "./editor.module.css";
import { PlanNote } from "./plan-note";

type Run = { state: "idle" } | { state: "running"; done: number; startedAt: number } | { state: "done"; result: ExportResult; url: string } | { state: "failed"; message: string };

const megabytes = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`);

/** The font the page's text uses, as a canvas wants it named (as the preview's). */
function pageFont(): string {
  const family = getComputedStyle(document.documentElement).getPropertyValue("--font-bricolage").trim();
  return family ? `${family}, system-ui, sans-serif` : "system-ui, sans-serif";
}

/** Render the edit to a video file, here in the browser, and hand it over to download. */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { edit, assets, missing, level } = useEditor();
  // 720p and 30 frames a second for everyone; 1080p and 60 with the plans that have them.
  const hd = can(level, "hd");
  const smooth = can(level, "smooth");
  const ref = useRef<HTMLDialogElement>(null);
  const stopper = useRef<AbortController | null>(null);
  const [height, setHeight] = useState<ExportHeight>(hd ? 1080 : 720);
  const [fps, setFps] = useState<ExportFps>(30);
  const [run, setRun] = useState<Run>({ state: "idle" });
  /** The clock, read once a second while rendering (for the time left). */
  const [now, setNow] = useState(0);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // The time left is worked out from the clock: redraw it every second while rendering.
  useEffect(() => {
    if (run.state !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [run.state]);

  // Leaving the page mid-export loses it: ask first.
  useEffect(() => {
    if (run.state !== "running") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [run.state]);

  const total = totalDuration(edit);
  const size = exportSize(edit.format, height);
  const lost = edit.clips.some((c) => missing.has(c.mediaId)) || edit.audio.some((a) => missing.has(a.mediaId));
  const problem = exportProblem(edit) ?? exportSupport() ?? (lost ? "A file of this edit is missing. Find it again under Media, or remove its clips." : null);

  function close() {
    stopper.current?.abort();
    stopper.current = null;
    if (run.state === "done") URL.revokeObjectURL(run.url);
    setRun({ state: "idle" });
    onClose();
  }

  async function start() {
    const controller = new AbortController();
    stopper.current = controller;
    const startedAt = Date.now();
    setRun({ state: "running", done: 0, startedAt });
    try {
      await document.fonts?.load(`800 40px ${pageFont()}`);
      const result = await exportEdit(edit, assets, { height: hd ? height : 720, fps: smooth ? fps : 30, font: pageFont(), signal: controller.signal, onProgress: (done) => setRun({ state: "running", done, startedAt }) });
      if (controller.signal.aborted) return;
      setRun({ state: "done", result, url: URL.createObjectURL(result.blob) });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setRun({ state: "failed", message: err instanceof ExportError ? err.message : "The export stopped part way. Try again." });
    }
  }

  const left = run.state === "running" && run.done > 0.03 && now > run.startedAt ? ((now - run.startedAt) / 1000 / run.done) * (1 - run.done) : null;
  const name = `${(edit.name || "Bamio edit").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Bamio edit"}`;

  return (
    <dialog
      ref={ref}
      className={`dialog ${styles.exportDialog}`}
      aria-labelledby="export-title"
      onClose={close}
      onCancel={(e) => {
        // Esc mid-render would throw the work away without a word.
        if (run.state === "running") e.preventDefault();
      }}
    >
      <h2 className="dialog-title" id="export-title">
        {run.state === "done" ? "Your video is ready" : run.state === "running" ? "Exporting…" : "Export"}
      </h2>

      {run.state === "idle" || run.state === "failed" ? (
        <>
          {run.state === "failed" ? (
            <p className={`notice is-error ${styles.exportNote}`}>
              <Warning size={18} weight="fill" aria-hidden /> {run.message}
            </p>
          ) : null}
          <div className="seg" role="group" aria-label="Quality">
            <button type="button" aria-pressed={height === 1080} disabled={!hd} onClick={() => setHeight(1080)}>
              {hd ? null : <LockSimple size={14} weight="fill" aria-hidden />} 1080p
            </button>
            <button type="button" aria-pressed={height === 720} onClick={() => setHeight(720)}>
              720p{hd ? " (faster)" : ""}
            </button>
          </div>
          {hd ? null : <PlanNote feature="hd" />}
          <div className="seg" role="group" aria-label="Frames a second">
            <button type="button" aria-pressed={fps === 30} onClick={() => setFps(30)}>
              30 a second
            </button>
            <button type="button" aria-pressed={fps === 60} disabled={!smooth} title="Smoother for gameplay and sport, when the video was recorded at 60" onClick={() => setFps(60)}>
              {smooth ? null : <LockSimple size={14} weight="fill" aria-hidden />} 60 a second
            </button>
          </div>
          {smooth ? null : <PlanNote feature="smooth" />}
          <p className="dialog-body">
            {clock(total, false)} long, {size.width} x {size.height}, {fps} frames a second, no watermark. It’s made here on your device: keep this tab open and in front until it’s done.
          </p>
          {problem ? (
            <p className={`notice is-warning ${styles.exportNote}`}>
              <Warning size={18} weight="fill" aria-hidden /> {problem}
            </p>
          ) : null}
          <div className="dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={close}>
              Not now
            </button>
            <button className="btn btn-primary" type="button" disabled={problem !== null} onClick={() => void start()}>
              {run.state === "failed" ? "Try again" : "Export the video"}
            </button>
          </div>
        </>
      ) : null}

      {run.state === "running" ? (
        <>
          <div className="progress" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(run.done * 100)}>
            <span style={{ "--value": `${Math.max(2, run.done * 100)}%` } as React.CSSProperties} />
          </div>
          <p className="dialog-body">
            {Math.round(run.done * 100)}% done{left !== null ? `, about ${left < 50 ? `${Math.max(1, Math.round(left / 5) * 5)} seconds` : `${Math.round(left / 60) || 1} min`} left` : ""}. Keep this tab open and in front.
          </p>
          <div className="dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={close}>
              Stop
            </button>
          </div>
        </>
      ) : null}

      {run.state === "done" ? (
        <>
          <video className={styles.exportVideo} src={run.url} controls playsInline />
          <p className="dialog-body">
            <CheckCircle size={16} weight="fill" aria-hidden /> {clock(run.result.seconds, false)}, {run.result.width} x {run.result.height}, {run.result.fps} frames a second, {megabytes(run.result.blob.size)}
            {run.result.extension === "webm" ? ". This browser can’t make an MP4, so it’s a WebM: Chrome or Edge will give you an MP4." : ""}
          </p>
          <div className="dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={close}>
              Back to the edit
            </button>
            <a className="btn btn-primary" href={run.url} download={`${name}.${run.result.extension}`}>
              <DownloadSimple size={18} aria-hidden /> Download
            </a>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
