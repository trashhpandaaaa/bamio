"use client";

import { CheckCircle, DownloadSimple, HardDrives, LockSimple, Warning } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { canSaveToDisk, exportEdit, ExportError, exportSize, exportSupport, type ExportFps, type ExportHeight, type ExportResult } from "@/lib/editor/export";
import { can } from "@/lib/editor/features";
import { clock, FORMAT_IDS, FORMATS, type FormatId } from "@/lib/editor/model";
import { exportProblem, totalDuration } from "@/lib/editor/timeline";
import { useEditor } from "./context";
import styles from "./editor.module.css";
import { editorFonts, fontsUsed, loadFonts } from "./fonts";
import { PlanNote } from "./plan-note";

type Made = { format: FormatId; result: ExportResult; url: string | null; fileName: string };
type Run =
  | { state: "idle" }
  | { state: "running"; done: number; startedAt: number; part: number; parts: number }
  | { state: "done"; made: Made[] }
  | { state: "failed"; message: string };

const megabytes = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`);

/** The save dialog of Chrome and Edge (File System Access), as far as this needs it. */
type SavePicker = (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<{ name: string; createWritable: () => Promise<FileSystemWritableFileStream> }>;

/** Render the edit to a video file (or one for each shape asked for), here in the browser, and hand it over. */
export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { edit, assets, missing, level } = useEditor();
  // 720p and 30 frames a second for everyone; the rest with the plans that have them.
  const hd = can(level, "hd");
  const smooth = can(level, "smooth");
  const big = can(level, "bigExport");
  const multi = can(level, "shapes");
  const ref = useRef<HTMLDialogElement>(null);
  const stopper = useRef<AbortController | null>(null);
  const [height, setHeight] = useState<ExportHeight>(hd ? 1080 : 720);
  const [fps, setFps] = useState<ExportFps>(30);
  const [others, setOthers] = useState<FormatId[]>([]);
  const [toDisk, setToDisk] = useState(false);
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

  const quality: ExportHeight = height === 2160 && !big ? (hd ? 1080 : 720) : height === 1080 && !hd ? 720 : height;
  const disk = toDisk && big && canSaveToDisk();
  // Several shapes come out as files in memory: on disk, one at a time.
  const shapes: FormatId[] = [edit.format, ...(multi && !disk ? others.filter((f) => f !== edit.format) : [])];
  const total = totalDuration(edit);
  const size = exportSize(edit.format, quality);
  const lost = [...edit.clips, ...edit.audio, ...edit.overlays].some((item) => missing.has(item.mediaId));
  const problem = exportProblem(edit, disk) ?? exportSupport() ?? (lost ? "A file of this edit is missing. Find it again under Media, or remove what uses it." : null);
  const name = `${(edit.name || "Bamio edit").replace(/[\\/:*?"<>|]+/g, " ").trim() || "Bamio edit"}`;
  const fileName = (format: FormatId, extension: string) => `${name}${shapes.length > 1 ? ` ${FORMATS[format].label.replace(":", "x")}` : ""}.${extension}`;

  function close() {
    stopper.current?.abort();
    stopper.current = null;
    if (run.state === "done") for (const m of run.made) if (m.url) URL.revokeObjectURL(m.url);
    setRun({ state: "idle" });
    onClose();
  }

  async function start() {
    // On disk: where to, asked now, while the click still counts as the person's (the browser insists).
    let file: { name: string; writable: FileSystemWritableFileStream } | null = null;
    if (disk) {
      try {
        const pick = (window as unknown as { showSaveFilePicker: SavePicker }).showSaveFilePicker;
        const handle = await pick({ suggestedName: `${name}.mp4`, types: [{ description: "Video", accept: { "video/mp4": [".mp4"], "video/webm": [".webm"] } }] });
        file = { name: handle.name, writable: await handle.createWritable() };
      } catch {
        // Closed without choosing.
        return;
      }
    }
    const controller = new AbortController();
    stopper.current = controller;
    const startedAt = Date.now();
    setRun({ state: "running", done: 0, startedAt, part: 0, parts: shapes.length });
    const fonts = editorFonts();
    const made: Made[] = [];
    try {
      await loadFonts(fonts, fontsUsed(edit));
      for (const [part, format] of shapes.entries()) {
        const result = await exportEdit({ ...edit, format }, assets, {
          height: quality,
          fps: smooth ? fps : 30,
          fonts,
          signal: controller.signal,
          disk: file?.writable,
          onProgress: (done) => setRun({ state: "running", done: (part + done) / shapes.length, startedAt, part, parts: shapes.length }),
        });
        if (controller.signal.aborted) return;
        made.push({ format, result, url: result.blob ? URL.createObjectURL(result.blob) : null, fileName: file?.name ?? fileName(format, result.extension) });
      }
      await file?.writable.close();
      setRun({ state: "done", made });
    } catch (err) {
      await file?.writable.abort().catch(() => undefined);
      for (const m of made) if (m.url) URL.revokeObjectURL(m.url);
      if (err instanceof DOMException && err.name === "AbortError") return;
      setRun({ state: "failed", message: err instanceof ExportError ? err.message : "The export stopped part way. Try again." });
    }
  }

  const left = run.state === "running" && run.done > 0.03 && now > run.startedAt ? ((now - run.startedAt) / 1000 / run.done) * (1 - run.done) : null;
  const toggleShape = (f: FormatId) => setOthers((list) => (list.includes(f) ? list.filter((x) => x !== f) : [...list, f]));

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
        {run.state === "done" ? (run.made.length > 1 ? "Your videos are ready" : "Your video is ready") : run.state === "running" ? "Exporting…" : "Export"}
      </h2>

      {run.state === "idle" || run.state === "failed" ? (
        <>
          {run.state === "failed" ? (
            <p className={`notice is-error ${styles.exportNote}`}>
              <Warning size={18} weight="fill" aria-hidden /> {run.message}
            </p>
          ) : null}
          <div className="seg" role="group" aria-label="Quality">
            <button type="button" aria-pressed={quality === 2160} disabled={!big} onClick={() => setHeight(2160)}>
              {big ? null : <LockSimple size={14} weight="fill" aria-hidden />} 4K
            </button>
            <button type="button" aria-pressed={quality === 1080} disabled={!hd} onClick={() => setHeight(1080)}>
              {hd ? null : <LockSimple size={14} weight="fill" aria-hidden />} 1080p
            </button>
            <button type="button" aria-pressed={quality === 720} onClick={() => setHeight(720)}>
              720p{hd ? " (faster)" : ""}
            </button>
          </div>
          {hd ? null : <PlanNote feature="hd" />}
          {hd && !big ? <PlanNote feature="bigExport" /> : null}
          <div className="seg" role="group" aria-label="Frames a second">
            <button type="button" aria-pressed={fps === 30} onClick={() => setFps(30)}>
              30 a second
            </button>
            <button type="button" aria-pressed={fps === 60} disabled={!smooth} title="Smoother for gameplay and sport, when the video was recorded at 60" onClick={() => setFps(60)}>
              {smooth ? null : <LockSimple size={14} weight="fill" aria-hidden />} 60 a second
            </button>
          </div>
          {smooth ? null : <PlanNote feature="smooth" />}
          <div className="field">
            <span className="field-label" id="export-shapes">
              Also export as
            </span>
            <div className={styles.chips} role="group" aria-labelledby="export-shapes">
              {FORMAT_IDS.filter((f) => f !== edit.format).map((f) => (
                <button key={f} className="chip" type="button" aria-pressed={shapes.includes(f)} disabled={!multi || disk} onClick={() => toggleShape(f)}>
                  {FORMATS[f].label} {FORMATS[f].name}
                </button>
              ))}
            </div>
            {multi ? null : <PlanNote feature="shapes" />}
          </div>
          {canSaveToDisk() ? (
            <label className={styles.switchRow}>
              <span>
                <HardDrives size={16} aria-hidden /> Save straight to disk (up to an hour long)
              </span>
              <input className="switch" type="checkbox" role="switch" checked={disk} disabled={!big} onChange={(e) => setToDisk(e.target.checked)} />
            </label>
          ) : null}
          <p className="dialog-body">
            {clock(total, false)} long, {size.width} x {size.height}, {smooth ? fps : 30} frames a second, no watermark{shapes.length > 1 ? `, in ${shapes.length} shapes` : ""}. It’s made here on your device: keep this tab
            open and in front until it’s done.
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
              {run.state === "failed" ? "Try again" : shapes.length > 1 ? `Export ${shapes.length} videos` : "Export the video"}
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
            {run.parts > 1 ? `Video ${run.part + 1} of ${run.parts}. ` : ""}
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
          {run.made[0]?.url ? <video className={styles.exportVideo} src={run.made[0].url} controls playsInline /> : null}
          <ul className={styles.madeList}>
            {run.made.map((m) => (
              <li key={m.format}>
                <p className="dialog-body">
                  <CheckCircle size={16} weight="fill" aria-hidden /> {FORMATS[m.format].label}: {clock(m.result.seconds, false)}, {m.result.width} x {m.result.height}, {m.result.fps} frames a second
                  {m.result.blob ? `, ${megabytes(m.result.blob.size)}` : `, saved as “${m.fileName}”`}
                  {m.result.extension === "webm" ? ". This browser can’t make an MP4, so it’s a WebM: Chrome or Edge will give you an MP4." : ""}
                </p>
                {m.url ? (
                  <a className="btn btn-primary btn-sm" href={m.url} download={m.fileName}>
                    <DownloadSimple size={16} aria-hidden /> Download{run.made.length > 1 ? ` ${FORMATS[m.format].label}` : ""}
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="dialog-actions">
            <button className="btn btn-ghost" type="button" onClick={close}>
              Back to the edit
            </button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
