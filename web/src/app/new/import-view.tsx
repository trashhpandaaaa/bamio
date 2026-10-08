"use client";

import { useUser } from "@clerk/nextjs";
import { CaretDown, Clock, CloudArrowUp, CreditCard, FilmStrip, Gift, Info, LinkSimple, WarningCircle, X } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { PlatformIcon } from "@/components/platform-icon";
import { useToast } from "@/components/toast";
import { useBilling } from "@/hooks/use-billing";
import { useSystemStatus } from "@/hooks/use-project";
import { useTrialCard } from "@/hooks/use-trial-card";
import { cardLabel, FREE_TRIAL, minutesLeft } from "@/lib/billing/plans";
import { api, isPlanError, uploadFile } from "@/lib/clips/api";
import { LanguageSelect } from "@/components/language-select";
import { ASPECT_LABEL, CAPTION_STYLE_LABEL, CLIP_LENGTH_LABEL, formatBytes } from "@/lib/clips/labels";
import { formatSpan, liveCaptureProblem, RECORD_CHOICES, REWIND_CHOICES } from "@/lib/clips/live";
import { formatTimecode, parseTimecode } from "@/lib/clips/logic";
import { ASPECTS, CAPTION_STYLES, CLIP_LENGTHS, LIMITS, type InspectResult } from "@/lib/clips/schema";
import { parseVideoUrl, sourceLabel } from "@/lib/clips/url";
import { FALLBACK_DEFAULTS, readClipDefaults, type ClipDefaults } from "@/lib/profile/defaults";
import styles from "./import.module.css";

type Mode = "link" | "upload";
type Inspect = { state: "idle" } | { state: "loading"; url: string } | { state: "ok"; url: string; info: InspectResult } | { state: "error"; url: string; message: string };
type Upload = { sent: number; total: number; startedAt: number; speed: number };

export function ImportView({ initialUrl, initialMode = "link", returnedCard }: { initialUrl?: string; initialMode?: Mode; returnedCard?: string }) {
  const { user, isLoaded } = useUser();
  if (!isLoaded) return <main id="main" className={`container ${styles.page}`} aria-busy="true" />;
  return <ImportForm defaults={user ? readClipDefaults(user.unsafeMetadata) : FALLBACK_DEFAULTS} initialUrl={initialUrl} initialMode={initialMode} returnedCard={returnedCard} />;
}

function ImportForm({ defaults, initialUrl, initialMode, returnedCard }: { defaults: ClipDefaults; initialUrl?: string; initialMode: Mode; returnedCard?: string }) {
  const router = useRouter();
  const toast = useToast();
  const status = useSystemStatus();
  const id = useId();

  const [mode, setMode] = useState<Mode>(initialMode);
  // A link passed in (from the landing page) is looked up straight away, like a pasted one.
  const [urlText, setUrlText] = useState(initialUrl ?? "");
  const [inspect, setInspect] = useState<Inspect>({ state: "idle" });
  const [usePart, setUsePart] = useState(false);
  const [partStart, setPartStart] = useState("");
  const [partEnd, setPartEnd] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [options, setOptions] = useState<ClipDefaults>(defaults);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** The error is one a plan fixes (no plan, minutes used up, projects full): link to Pricing. */
  const [planError, setPlanError] = useState(false);
  const [upload, setUpload] = useState<Upload | null>(null);
  /** A chosen file's length in seconds, as the browser read it (null if it can't play the file). */
  const [measured, setMeasured] = useState<{ file: File; sec: number | null } | null>(null);
  const fileSec = measured && measured.file === file ? measured.sec : null;
  const [rewind, setRewind] = useState(0);
  const [record, setRecord] = useState(300);
  /** Live streams: follow the whole stream while it goes on, or capture a part of it. */
  const [liveMode, setLiveMode] = useState<"follow" | "part">("follow");
  const uploadAbort = useRef<AbortController | null>(null);

  const aiOn = status?.ai.configured !== false;
  const linksOn = status?.ytdlp !== null;
  // Plans (with Stripe on): importing needs one, and uses its AI minutes; a new account has its first video free (the trial's minutes).
  const billingOn = status?.billing === true;
  const { billing, refresh: refreshBilling } = useBilling({ enabled: billingOn });
  const trialLeft = billing?.trial ? minutesLeft({ ...billing.trial, resetsAt: 0 }) : null;
  const onTrial = trialLeft !== null && trialLeft > 0;
  const noPlan = billingOn && billing !== null && !billing.active && !onTrial;
  // The free video starts once a card is on file (Stripe checks it; nothing is charged). A pasted link survives the trip to Stripe.
  const trialCard = onTrial ? (billing?.trial?.card ?? null) : null;
  const needsCard = onTrial && trialCard === null;
  const card = useTrialCard({ from: "new", returned: returnedCard, link: parseVideoUrl(urlText.trim()).ok ? urlText.trim() : undefined, onAdded: refreshBilling });
  const set = <K extends keyof ClipDefaults>(key: K, value: ClipDefaults[K]) => setOptions((o) => ({ ...o, [key]: value }));
  const fail = (err: unknown, fallback: string) => {
    setFormError(err instanceof Error ? err.message : fallback);
    setPlanError(isPlanError(err));
  };

  // Look the link up shortly after it's pasted or typed.
  useEffect(() => {
    const text = urlText.trim();
    if (!text || !parseVideoUrl(text).ok) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setInspect({ state: "loading", url: text });
      api
        .inspect(text, controller.signal)
        .then((info) => {
          setInspect({ state: "ok", url: text, info });
          if (info.live) {
            // Streams that can rewind (Twitch) default to "what just happened"; others record 5 min.
            setRewind(info.live.canRewind ? Math.min(300, info.live.rewindSec) : 0);
            setRecord(info.live.canRewind ? 0 : 300);
          } else if (info.durationSec > LIMITS.maxMediaSec) {
            setUsePart(true);
            setPartStart("0:00");
            setPartEnd(formatTimecode(LIMITS.maxMediaSec));
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setInspect({ state: "error", url: text, message: err instanceof Error ? err.message : "Couldn’t read that link." });
        });
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [urlText]);

  // A chosen file's length, where the browser can read it, for the AI minutes it will use.
  useEffect(() => {
    if (!file) return;
    let current = true;
    void videoDuration(file).then((sec) => {
      if (current) setMeasured({ file, sec });
    });
    return () => {
      current = false;
    };
  }, [file]);

  // Leaving mid-upload loses the upload; ask first.
  useEffect(() => {
    if (!upload) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [upload]);

  const urlCheck = urlText.trim() ? parseVideoUrl(urlText) : null;
  const info = inspect.state === "ok" && inspect.url === urlText.trim() ? inspect.info : null;
  const tooLong = info && !info.live ? info.durationSec > LIMITS.maxMediaSec : false;
  const liveProblem = info?.live && liveMode === "part" ? liveCaptureProblem(rewind, record, info.live) : null;
  const edit = { aspect: options.aspect, captions: options.captions, captionStyle: options.captionStyle };
  const findClips = options.findClips && aiOn;

  function partRange(): { start: number; end: number } | undefined | string {
    if (!usePart || !info) return undefined;
    const start = parseTimecode(partStart || "0");
    const end = parseTimecode(partEnd);
    if (start === null) return "Enter the start as a time, like 1:30.";
    if (end === null) return "Enter the end as a time, like 12:45.";
    if (end <= start) return "The end must be after the start.";
    if (start >= info.durationSec) return `The start must be before the video ends (${formatTimecode(info.durationSec)}).`;
    if (end - start < LIMITS.minClipSec) return "Choose a part at least 3 seconds long.";
    if (Math.min(end, info.durationSec) - start > LIMITS.maxMediaSec) return "Choose a part up to 3 hours long.";
    return { start, end: Math.min(end, info.durationSec) };
  }

  // What the import will use of the plan's minutes: a link's (part's) length, or a file's when the browser could read it.
  const range = mode === "link" && info && !info.live ? partRange() : undefined;
  const neededSec =
    mode === "upload" ? (file ? fileSec : null) : !info || info.live ? null : typeof range === "object" ? range.end - range.start : usePart ? null : info.durationSec;
  const left = billing?.usage ? minutesLeft(billing.usage) : onTrial ? trialLeft : null;
  const short = neededSec !== null && left !== null && Math.ceil(neededSec / 60) > left + 1;

  async function submitLink() {
    if (!info) return;
    if (info.live) {
      if (liveProblem) return setFormError(liveProblem);
      setSubmitting(true);
      try {
        const project = await api.createFromUrl({
          url: info.url,
          live: liveMode === "follow" ? { follow: true, rewindSec: 0, recordSec: 0 } : { rewindSec: rewind, recordSec: record },
          findClips,
          clipLength: options.clipLength,
          language: options.language,
          edit,
        });
        router.push(`/projects/${project.id}`);
      } catch (err) {
        setSubmitting(false);
        fail(err, "Couldn’t start the capture.");
      }
      return;
    }
    const range = partRange();
    if (typeof range === "string") return setFormError(range);
    if (tooLong && !range) return setFormError("This video is longer than 3 hours. Choose a part of it to import.");
    setSubmitting(true);
    try {
      const project = await api.createFromUrl({ url: info.url, range, findClips, clipLength: options.clipLength, language: options.language, edit });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      setSubmitting(false);
      fail(err, "Couldn’t start the import.");
    }
  }

  async function submitUpload() {
    if (!file) return;
    if (file.size > LIMITS.maxUploadBytes) return setFormError(`That file is ${formatBytes(file.size)}. The limit is ${formatBytes(LIMITS.maxUploadBytes)}.`);
    setSubmitting(true);
    const controller = new AbortController();
    uploadAbort.current = controller;
    let projectId: string | null = null;
    try {
      const created = await api.createUpload({ fileName: file.name.slice(-200), size: file.size, findClips, clipLength: options.clipLength, language: options.language, edit });
      projectId = created.project.id;
      const startedAt = Date.now();
      setUpload({ sent: 0, total: file.size, startedAt, speed: 0 });
      await uploadFile(projectId, file, created.chunkBytes, {
        signal: controller.signal,
        onProgress: (sent) => {
          const elapsed = (Date.now() - startedAt) / 1000;
          setUpload((u) => (u ? { ...u, sent, speed: elapsed > 1.5 ? sent / elapsed : 0 } : u));
        },
      });
      router.push(`/projects/${projectId}`);
    } catch (err) {
      setSubmitting(false);
      setUpload(null);
      if (projectId) void api.deleteProject(projectId).catch(() => undefined);
      if (err instanceof DOMException && err.name === "AbortError") {
        toast({ tone: "info", title: "Upload cancelled" });
        return;
      }
      fail(err, "The upload failed. Try again.");
    } finally {
      uploadAbort.current = null;
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setPlanError(false);
    if (mode === "link") void submitLink();
    else void submitUpload();
  }

  function chooseFile(next: File | undefined) {
    if (!next) return;
    setFormError(null);
    if (next.size > LIMITS.maxUploadBytes) {
      setFormError(`That file is ${formatBytes(next.size)}. The limit is ${formatBytes(LIMITS.maxUploadBytes)}.`);
      return;
    }
    setFile(next);
  }

  // Longer than the AI minutes left: the reason shows above the button (the server checks again; an upload's length only once it's sent).
  const canSubmit = !submitting && !noPlan && !needsCard && !short && (mode === "link" ? Boolean(info) && linksOn : Boolean(file));
  const pct = upload ? Math.floor((upload.sent / upload.total) * 100) : 0;

  return (
    <main id="main" className={`container ${styles.page}`}>
      <div className={styles.head}>
        <h1 className="t-heading-xl">Import a video</h1>
        <p className="t-secondary">Paste a link from YouTube, Twitch, Kick and most video sites, or upload a file.</p>
      </div>

      {noPlan ? (
        <div className={`notice is-warning ${styles.planNotice}`}>
          <WarningCircle size={20} weight="fill" aria-hidden />
          <p>
            <strong>{billing?.plan ? "Your plan has ended" : billing?.trial ? "You’ve used your free video" : "Choose a plan to import videos"}</strong>
            Every plan finds the moments, captions every word and exports 1080p with no watermark. Your projects stay as they are.
          </p>
          <Link href="/pricing" className="btn btn-volt btn-sm">
            See plans
          </Link>
        </div>
      ) : needsCard ? (
        <div className={`notice ${styles.planNotice}`} role="status">
          <CreditCard size={20} weight="fill" aria-hidden />
          <p>
            <strong>{card.checking ? "Checking your card…" : "Your first video is free. Add a card to start"}</strong>
            Up to {FREE_TRIAL.minutes} minutes of it, with every feature and no watermark. Your card is only checked: nothing is charged, and no plan starts by itself.
          </p>
          <button className="btn btn-volt btn-sm" type="button" disabled={card.busy} aria-busy={card.busy} onClick={() => void card.start()}>
            Add a card
          </button>
        </div>
      ) : onTrial && trialCard && billing?.trial?.usedSec === 0 ? (
        <div className={`notice ${styles.planNotice}`} role="status">
          <Gift size={20} weight="fill" aria-hidden />
          <p>
            <strong>Your first video is free</strong>
            Up to {FREE_TRIAL.minutes} minutes of it, with every feature and no watermark. {cardLabel(trialCard)} is on file; nothing is charged.
          </p>
          <Link href="/pricing" className="btn btn-secondary btn-sm">
            See plans
          </Link>
        </div>
      ) : null}
      {card.problem ? (
        <div className={`notice is-warning ${styles.planNotice}`} role="alert">
          <WarningCircle size={20} weight="fill" aria-hidden />
          <p>
            <strong>Your card wasn’t added</strong>
            {card.problem}
          </p>
          <Link href="/pricing" className="btn btn-secondary btn-sm">
            See plans
          </Link>
        </div>
      ) : null}

      <form className={styles.layout} onSubmit={onSubmit} noValidate>
        <section className={styles.source} aria-label="Video">
          <div className="seg" role="group" aria-label="Import from">
            <button type="button" aria-pressed={mode === "link"} onClick={() => setMode("link")} disabled={submitting}>
              <LinkSimple size={16} aria-hidden /> Paste a link
            </button>
            <button type="button" aria-pressed={mode === "upload"} onClick={() => setMode("upload")} disabled={submitting}>
              <CloudArrowUp size={16} aria-hidden /> Upload a file
            </button>
          </div>

          {mode === "link" ? (
            <div className={styles.panel}>
              {!linksOn ? (
                <div className="notice is-warning">
                  <WarningCircle size={20} weight="fill" aria-hidden />
                  <p>
                    <strong>Link import isn’t set up on this server</strong>
                    In <code>web/</code>, run <code>npm run setup:media</code>, then restart the server. Uploads still work.
                  </p>
                </div>
              ) : null}
              <div className="field">
                <label className="field-label" htmlFor={`${id}-url`}>
                  Video link
                </label>
                <div className="input-wrap">
                  <LinkSimple size={18} aria-hidden />
                  <input
                    id={`${id}-url`}
                    className="input"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="https://www.youtube.com/watch?v=…"
                    value={urlText}
                    disabled={submitting || !linksOn}
                    aria-invalid={urlCheck && !urlCheck.ok ? true : undefined}
                    aria-describedby={`${id}-url-help`}
                    onChange={(e) => {
                      setUrlText(e.target.value);
                      setFormError(null);
                      if (!e.target.value.trim()) setInspect({ state: "idle" });
                    }}
                  />
                </div>
                {urlCheck && !urlCheck.ok ? (
                  <p className="field-error" id={`${id}-url-help`}>
                    <WarningCircle size={14} weight="fill" aria-hidden /> {urlCheck.message}
                  </p>
                ) : inspect.state === "error" && inspect.url === urlText.trim() ? (
                  <p className="field-error" id={`${id}-url-help`} role="alert">
                    <WarningCircle size={14} weight="fill" aria-hidden /> {inspect.message}
                  </p>
                ) : (
                  <p className="field-help" id={`${id}-url-help`}>
                    Videos, VODs, clips and live streams.
                  </p>
                )}
              </div>

              {inspect.state === "loading" && inspect.url === urlText.trim() ? (
                <div className={styles.preview} aria-busy="true" aria-label="Checking the link">
                  <div className={`skeleton ${styles.previewThumb}`} />
                  <div className={styles.previewText}>
                    <div className="skeleton" style={{ height: 18, width: "80%" }} />
                    <div className="skeleton" style={{ height: 14, width: "40%" }} />
                  </div>
                </div>
              ) : null}

              {info ? (
                <div className={styles.preview}>
                  <div className={styles.previewThumb}>
                    {info.thumbnail ? (
                      // A remote thumbnail from the video site.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={info.thumbnail} alt="" referrerPolicy="no-referrer" />
                    ) : (
                      <FilmStrip size={28} aria-hidden />
                    )}
                    {info.live ? (
                      <span className={`badge is-live ${styles.previewLive}`}>Live</span>
                    ) : (
                      <span className={styles.previewDur}>{formatTimecode(info.durationSec)}</span>
                    )}
                  </div>
                  <div className={styles.previewText}>
                    <p className={styles.previewTitle}>{info.title}</p>
                    <p className="card-meta">
                      <span className="badge">
                        <PlatformIcon platform={info.platform} size={14} /> {sourceLabel(info.platform, info.url)}
                      </span>
                      {info.uploader ? <span>{info.uploader}</span> : null}
                      {info.live && info.durationSec > 0 ? <span>Streaming for {formatSpan(info.durationSec)}</span> : null}
                    </p>
                  </div>
                </div>
              ) : null}

              {info?.live ? (
                <LiveCapture
                  live={info.live}
                  mode={liveMode}
                  onMode={setLiveMode}
                  rewind={rewind}
                  record={record}
                  onRewind={setRewind}
                  onRecord={setRecord}
                  disabled={submitting}
                  problem={liveProblem}
                  leftSec={left === null ? null : left * 60}
                />
              ) : null}

              {info && !info.live ? (
                <div className={styles.part}>
                  <label className="choice">
                    <input className="switch" type="checkbox" role="switch" checked={usePart} disabled={submitting || tooLong} onChange={(e) => setUsePart(e.target.checked)} />
                    Import only part of the video
                  </label>
                  {tooLong ? <p className="field-help">This video is longer than 3 hours, so choose a part of it (up to 3 hours).</p> : null}
                  {usePart ? (
                    <div className={styles.partRow}>
                      <div className="field">
                        <label className="field-label" htmlFor={`${id}-from`}>
                          From
                        </label>
                        <input id={`${id}-from`} className={`input ${styles.time}`} placeholder="0:00" value={partStart} onChange={(e) => setPartStart(e.target.value)} disabled={submitting} />
                      </div>
                      <div className="field">
                        <label className="field-label" htmlFor={`${id}-to`}>
                          To
                        </label>
                        <input
                          id={`${id}-to`}
                          className={`input ${styles.time}`}
                          placeholder={formatTimecode(info.durationSec)}
                          value={partEnd}
                          onChange={(e) => setPartEnd(e.target.value)}
                          disabled={submitting}
                        />
                      </div>
                      <p className="field-help">Faster for long streams: only this part is downloaded.</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className={styles.panel}>
              <label
                className={styles.drop}
                data-dragging={dragging ? "" : undefined}
                data-has-file={file ? "" : undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!submitting) chooseFile(e.dataTransfer.files[0]);
                }}
              >
                <input
                  className="sr-only"
                  type="file"
                  accept="video/*,.mkv,.flv,.ts,.m4v"
                  disabled={submitting}
                  onChange={(e) => {
                    chooseFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                <CloudArrowUp size={36} aria-hidden />
                {file ? (
                  <>
                    <span className={styles.dropTitle}>{file.name}</span>
                    <span className="t-body-sm t-secondary">{formatBytes(file.size)}. Click to choose a different file.</span>
                  </>
                ) : (
                  <>
                    <span className={styles.dropTitle}>Drop a video here, or click to choose</span>
                    <span className="t-body-sm t-secondary">MP4, MOV, MKV, WebM and more. Up to {formatBytes(LIMITS.maxUploadBytes)} and 3 hours.</span>
                  </>
                )}
              </label>

              {upload ? (
                <div className={styles.uploading} aria-live="polite">
                  <div className={styles.uploadRow}>
                    <span className="t-label">Uploading {pct}%</span>
                    <span className="t-mono t-tertiary">
                      {formatBytes(upload.sent)} of {formatBytes(upload.total)}
                      {upload.speed > 0 ? `, ${formatBytes(upload.speed)}/s` : ""}
                    </span>
                  </div>
                  <div className="progress" role="progressbar" aria-label="Upload" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                    <span style={{ "--value": `${Math.max(pct, 1)}%` } as React.CSSProperties} />
                  </div>
                  <div className={styles.uploadRow}>
                    <span className="t-caption t-tertiary">Keep this tab open until the upload finishes.</span>
                    <button className="btn btn-ghost btn-sm" type="button" onClick={() => uploadAbort.current?.abort()}>
                      <X size={16} aria-hidden /> Cancel upload
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          <p className={styles.rights}>
            <Info size={16} aria-hidden />
            Only import videos you own or have permission to use.
          </p>
        </section>

        <aside className={styles.options} aria-label="Clip settings">
          <h2 className="t-heading-sm">Clip settings</h2>

          <LanguageSelect value={options.language} disabled={submitting} onChange={(code) => set("language", code)} />

          <div className="field">
            <label className="choice">
              <input className="switch" type="checkbox" role="switch" checked={findClips} disabled={!aiOn || submitting} onChange={(e) => set("findClips", e.target.checked)} />
              Find the best clips with AI
            </label>
            <p className="field-help">
              {aiOn ? "Bamio transcribes the video and suggests moments that work as shorts." : "AI is off on this server. Add GEMINI_API_KEY to web/.env to turn it on."}
            </p>
          </div>

          <div className="field">
            <span className="field-label" id={`${id}-len`}>
              Clip length
            </span>
            <div className="seg" role="group" aria-labelledby={`${id}-len`}>
              {CLIP_LENGTHS.map((l) => (
                <button key={l} type="button" aria-pressed={options.clipLength === l} disabled={!findClips || submitting} onClick={() => set("clipLength", l)}>
                  {CLIP_LENGTH_LABEL[l]}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span className="field-label" id={`${id}-aspect`}>
              Format
            </span>
            <div className="seg" role="group" aria-labelledby={`${id}-aspect`}>
              {ASPECTS.map((a) => (
                <button key={a} type="button" aria-pressed={options.aspect === a} disabled={submitting} onClick={() => set("aspect", a)}>
                  {ASPECT_LABEL[a]}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="choice">
              <input className="switch" type="checkbox" role="switch" checked={options.captions} disabled={submitting} onChange={(e) => set("captions", e.target.checked)} />
              Captions
            </label>
            <div className={styles.chips} role="group" aria-label="Caption style">
              {CAPTION_STYLES.map((s) => (
                <button key={s} type="button" className="chip" aria-pressed={options.captionStyle === s} disabled={!options.captions || submitting} onClick={() => set("captionStyle", s)}>
                  {CAPTION_STYLE_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {left !== null ? (
            <p className={styles.minutes} data-short={short ? "" : undefined}>
              <Clock size={16} aria-hidden />
              <span>
                {onTrial && !billing?.usage
                  ? neededSec === null
                    ? `${left.toLocaleString()} free ${left === 1 ? "minute" : "minutes"} left.`
                    : short
                      ? `This needs about ${Math.ceil(neededSec / 60).toLocaleString()} minutes, and your free trial has ${left.toLocaleString()} left. ${mode === "upload" ? "Upload a shorter video" : "Import a part of it"}, or choose a plan.`
                      : `Uses about ${Math.max(1, Math.ceil(neededSec / 60)).toLocaleString()} of your ${left.toLocaleString()} free minutes.`
                  : neededSec === null
                    ? `${left.toLocaleString()} AI ${left === 1 ? "minute" : "minutes"} left this month.`
                    : short
                      ? `This needs about ${Math.ceil(neededSec / 60).toLocaleString()} AI minutes, and ${left.toLocaleString()} are left this month. ${mode === "upload" ? "Upload a shorter video" : "Import a part of it"}, or upgrade.`
                      : `Uses about ${Math.max(1, Math.ceil(neededSec / 60)).toLocaleString()} of your ${left.toLocaleString()} AI minutes left this month.`}{" "}
                <Link href={onTrial || left < 30 || short ? "/pricing" : "/billing"} className="link">
                  {onTrial ? "Plans" : left < 30 || short ? "Get more" : "Your plan"}
                </Link>
              </span>
            </p>
          ) : null}

          {formError ? (
            <p className="field-error" role="alert">
              <WarningCircle size={14} weight="fill" aria-hidden />
              <span>
                {formError}
                {planError && billingOn ? (
                  <>
                    {" "}
                    <Link href="/pricing" className="link">
                      See plans
                    </Link>
                  </>
                ) : null}
              </span>
            </p>
          ) : null}

          <button className="btn btn-volt btn-lg" type="submit" disabled={!canSubmit} aria-busy={submitting}>
            {submitting
              ? mode === "upload"
                ? "Uploading…"
                : "Starting…"
              : mode === "link" && info?.live
                ? liveMode === "follow"
                  ? "Start following"
                  : record > 0
                    ? "Start recording"
                    : "Capture"
                : findClips
                  ? "Import and find clips"
                  : "Import"}
          </button>
        </aside>
      </form>
    </main>
  );
}

/** A video file's length from its metadata, read by the browser (null if it can't play the file, or takes too long). */
function videoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (sec: number | null) => {
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(sec);
    };
    const timer = setTimeout(() => done(null), 8000);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () => done(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

/**
 * A live stream: follow all of it (from as far back as it keeps, growing until it ends,
 * editable meanwhile), or capture a part: how far back to start (if the stream allows)
 * and how long to keep recording.
 */
function LiveCapture({
  live,
  mode,
  onMode,
  rewind,
  record,
  onRewind,
  onRecord,
  disabled,
  problem,
  leftSec,
}: {
  live: NonNullable<InspectResult["live"]>;
  mode: "follow" | "part";
  onMode: (mode: "follow" | "part") => void;
  rewind: number;
  record: number;
  onRewind: (s: number) => void;
  onRecord: (s: number) => void;
  disabled: boolean;
  problem: string | null;
  /** AI minutes left (seconds), when plans are on: following takes no more of the stream than that. */
  leftSec: number | null;
}) {
  const id = useId();
  const rewindChoices: number[] = REWIND_CHOICES.filter((s) => s <= live.rewindSec);
  // Offer the whole stream so far when it fits in one capture.
  if (live.canRewind && live.rewindSec <= LIMITS.maxMediaSec && !rewindChoices.includes(live.rewindSec)) rewindChoices.push(live.rewindSec);
  const recordChoices = RECORD_CHOICES.filter((s) => s > 0 || (live.canRewind && rewind > 0));
  const summary = live.canRewind
    ? rewind > 0 && record > 0
      ? `Captures from ${formatSpan(rewind)} ago until ${formatSpan(record)} from now.`
      : rewind > 0
        ? `Captures the last ${formatSpan(rewind)}.`
        : `Records the next ${formatSpan(record)}.`
    : `Records the next ${formatSpan(record)}, plus the last few seconds the stream still has.`;

  // With plans on, no further back than the minutes left (the server holds it there too: followLimits).
  const cappedBack = leftSec !== null && leftSec < live.followBackSec;
  const followFrom = cappedBack
    ? leftSec >= 60
      ? `Starts ${formatSpan(leftSec)} back (your minutes left)`
      : "Starts now"
    : live.followFromStart
    ? "Starts at the beginning of the stream"
    : live.followBackSec >= 60
      ? `Starts ${formatSpan(live.followBackSec)} back${live.canRewind ? ", as far as the stream keeps" : ""}`
      : "Starts now (this stream keeps only its last few seconds)";

  return (
    <div className={styles.live}>
      <p className={styles.liveTitle}>
        <span className="badge is-live">Live now</span>
      </p>
      <div className="seg" role="group" aria-label="What to capture">
        <button type="button" aria-pressed={mode === "follow"} disabled={disabled} onClick={() => onMode("follow")}>
          Follow the stream
        </button>
        <button type="button" aria-pressed={mode === "part"} disabled={disabled} onClick={() => onMode("part")}>
          Capture a part
        </button>
      </div>
      {mode === "follow" ? (
        <p className="field-help">
          {followFrom} and keeps adding to it until the stream ends, you stop, or{" "}
          {leftSec !== null && leftSec < LIMITS.maxFollowSec ? `${formatSpan(Math.max(60, leftSec))} (your minutes left)` : formatSpan(LIMITS.maxFollowSec)} are captured. You can clip, edit and
          export while it grows; captions and AI clips follow along.
        </p>
      ) : (
        <>
          <div className={styles.liveRow}>
            {live.canRewind ? (
              <div className="field">
                <label className="field-label" htmlFor={`${id}-rewind`}>
                  Start from
                </label>
                <div className="select-wrap">
                  <select id={`${id}-rewind`} className="select" value={rewind} disabled={disabled} onChange={(e) => onRewind(Number(e.target.value))}>
                    {rewindChoices.map((s) => (
                      <option key={s} value={s}>
                        {s === 0 ? "Now" : s === live.rewindSec && s > 3600 ? `The start of the stream (${formatSpan(s)} ago)` : s === live.rewindSec ? "The start of the stream" : `${formatSpan(s)} ago`}
                      </option>
                    ))}
                  </select>
                  <CaretDown size={16} aria-hidden />
                </div>
              </div>
            ) : null}
            <div className="field">
              <label className="field-label" htmlFor={`${id}-record`}>
                Keep recording for
              </label>
              <div className="select-wrap">
                <select id={`${id}-record`} className="select" value={record} disabled={disabled} onChange={(e) => onRecord(Number(e.target.value))}>
                  {recordChoices.map((s) => (
                    <option key={s} value={s}>
                      {s === 0 ? "Stop at now" : formatSpan(s)}
                    </option>
                  ))}
                </select>
                <CaretDown size={16} aria-hidden />
              </div>
            </div>
          </div>
          {problem ? (
            <p className="field-error" role="alert">
              <WarningCircle size={14} weight="fill" aria-hidden /> {problem}
            </p>
          ) : (
            <p className="field-help">
              {summary} {record > 0 ? "You can stop the recording early." : ""}
              {!live.canRewind ? " This stream keeps only a few seconds of history, so start recording before the moment you want." : ""}
            </p>
          )}
        </>
      )}
    </div>
  );
}
