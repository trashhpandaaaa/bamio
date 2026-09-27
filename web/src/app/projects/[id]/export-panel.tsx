"use client";

import { Check, DownloadSimple, Export, Info, Microphone, WarningCircle } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useSyncExternalStore, type Dispatch } from "react";
import { useToast } from "@/components/toast";
import { sceneCanHavePicture, sceneNeedsVoice } from "@/hooks/use-scene-media";
import type { ProjectAction } from "@/lib/project/ops";
import type { Project } from "@/lib/project/schema";
import { buildTimeline, formatDuration } from "@/lib/project/timeline";
import { canExport, exportVideo, extensionFor, pickRecordingMime } from "@/lib/render/export";
import { EXPORT_SIZE } from "@/lib/render/renderer";
import styles from "./export.module.css";
import type { Media } from "./workspace";

type Props = { project: Project; dispatch: Dispatch<ProjectAction>; media: Media };
type Result = { url: string; mime: string; bytes: number; name: string };

const noop = () => () => undefined;
const sizeFormat = new Intl.NumberFormat(undefined, { style: "unit", unit: "megabyte", maximumFractionDigits: 1 });

function slug(title: string): string {
  const s = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "bamio-video";
}

export function ExportPanel({ project, dispatch, media }: Props) {
  const toast = useToast();
  const supported = useSyncExternalStore(noop, canExport, () => true);
  const format = useSyncExternalStore(noop, () => pickRecordingMime(), () => null);
  const [phase, setPhase] = useState<"idle" | "rendering" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const controller = useRef<AbortController | null>(null);

  const timeline = buildTimeline(project);
  const withoutPicture = project.scenes.filter((s) => sceneCanHavePicture(s) && !s.imageId).length;
  const voiceToDo = project.scenes.filter((s) => sceneNeedsVoice(s, project)).length;
  const emptyCaptions = project.scenes.filter((s) => !s.caption.trim()).length;

  // Revoke the old download URL when replaced or on unmount; cancel a running export on unmount.
  useEffect(() => () => void (result && URL.revokeObjectURL(result.url)), [result]);
  useEffect(() => () => controller.current?.abort(), []);

  // Warn before leaving mid-render.
  useEffect(() => {
    if (phase !== "rendering") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  async function run() {
    controller.current = new AbortController();
    setPhase("rendering");
    setProgress(0);
    setError(null);
    let last = 0;
    try {
      const out = await exportVideo(project, {
        signal: controller.current.signal,
        onProgress: (f) => {
          if (f - last >= 0.01 || f === 1) {
            last = f;
            setProgress(f);
          }
        },
      });
      const name = `${slug(project.title)}.${extensionFor(out.mime)}`;
      setResult({ url: URL.createObjectURL(out.blob), mime: out.mime, bytes: out.blob.size, name });
      dispatch({ type: "setExport", mime: out.mime, bytes: out.blob.size, at: Date.now() });
      setPhase("idle");
      toast({ tone: "success", title: "Video exported", body: `${name}, ${sizeFormat.format(out.blob.size / 1_000_000)}` });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setPhase("idle");
        return;
      }
      setError(err instanceof Error ? err.message : "The export failed. Try again.");
      setPhase("error");
    }
  }

  const rendering = phase === "rendering";

  return (
    <div className={styles.wrap}>
      <div className={styles.main}>
        <h2 className="t-heading-lg">Export</h2>
        <dl className={styles.specs}>
          <div>
            <dt>Length</dt>
            <dd className="t-mono">{formatDuration(timeline.total)}</dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd className="t-mono">
              {EXPORT_SIZE.width}&nbsp;×&nbsp;{EXPORT_SIZE.height}
            </dd>
          </div>
          <div>
            <dt>Format</dt>
            <dd className="t-mono">{format ? extensionFor(format).toUpperCase() : "n/a"}</dd>
          </div>
          <div>
            <dt>Scenes</dt>
            <dd className="t-mono">{project.scenes.length}</dd>
          </div>
        </dl>

        <ul className={styles.checks} aria-label="Before you export">
          {withoutPicture > 0 ? (
            <li>
              <Info size={18} aria-hidden />
              <span>
                {withoutPicture} {withoutPicture === 1 ? "scene has" : "scenes have"} no picture and will play as a bold text card.
              </span>
            </li>
          ) : (
            <li>
              <Check size={18} aria-hidden className={styles.ok} />
              <span>Every scene has its picture.</span>
            </li>
          )}
          {project.brief.voiceover ? (
            voiceToDo > 0 ? (
              <li className={styles.warn}>
                <WarningCircle size={18} aria-hidden />
                <span>
                  {voiceToDo} {voiceToDo === 1 ? "scene is" : "scenes are"} missing an up-to-date voice-over and will be silent.
                </span>
                <button className="btn btn-secondary btn-sm" type="button" disabled={media.busy.size > 0 || rendering} aria-busy={media.busy.size > 0} onClick={() => void media.generateAllVoice()}>
                  {media.busy.size > 0 ? null : <Microphone size={16} aria-hidden />}
                  {media.busy.size > 0 ? "Recording…" : "Record now"}
                </button>
              </li>
            ) : (
              <li>
                <Check size={18} aria-hidden className={styles.ok} />
                <span>Voice-over is recorded for every scene.</span>
              </li>
            )
          ) : null}
          {emptyCaptions > 0 ? (
            <li>
              <Info size={18} aria-hidden />
              <span>
                {emptyCaptions} {emptyCaptions === 1 ? "scene has" : "scenes have"} no caption. Most people watch with the sound off.
              </span>
            </li>
          ) : null}
        </ul>

        {!supported ? (
          <div className="notice is-warning" role="status">
            <WarningCircle size={20} aria-hidden />
            <p>This browser can’t record video. Use a recent Chrome, Edge or Firefox to export.</p>
          </div>
        ) : null}

        {error ? (
          <div className="notice is-error" role="alert">
            <WarningCircle size={20} aria-hidden />
            <p>{error}</p>
          </div>
        ) : null}

        {rendering ? (
          <div className={styles.progressBox} role="status" aria-live="polite">
            <div className={styles.progressHead}>
              <span className="t-label">Rendering… {Math.round(progress * 100)}%</span>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => controller.current?.abort()}>
                Cancel
              </button>
            </div>
            <div className="progress" role="progressbar" aria-label="Export progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} style={{ ["--value" as string]: `${progress * 100}%` }}>
              <span />
            </div>
            <p className="t-caption t-tertiary">Rendering plays the video in real time. Keep this tab open and visible until it finishes.</p>
          </div>
        ) : (
          <div className={styles.actions}>
            <button className="btn btn-volt btn-lg" type="button" disabled={!supported || timeline.total <= 0 || media.busy.size > 0} onClick={() => void run()}>
              <Export size={18} aria-hidden />
              {result ? "Export again" : "Export video"}
            </button>
          </div>
        )}
      </div>

      <div className={styles.result}>
        {result ? (
          <>
            <video className={styles.video} src={result.url} controls playsInline width={EXPORT_SIZE.width / 4} height={EXPORT_SIZE.height / 4}>
              <track kind="captions" />
            </video>
            <a className="btn btn-primary" href={result.url} download={result.name}>
              <DownloadSimple size={18} aria-hidden />
              Download {extensionFor(result.mime).toUpperCase()}
            </a>
            <p className="t-caption t-tertiary">
              {result.name}, {sizeFormat.format(result.bytes / 1_000_000)}
            </p>
          </>
        ) : (
          <div className={styles.placeholder}>
            <p className="t-body-sm t-secondary">Your exported video appears here, ready to download and post.</p>
          </div>
        )}
      </div>
    </div>
  );
}
