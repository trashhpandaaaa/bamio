"use client";

import { CheckCircle, DownloadSimple, FilmSlate, LinkSimple, PencilSimple, Trash, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useToast } from "@/components/toast";
import { api, downloadFileUrl } from "@/lib/clips/api";
import { formatTimecode } from "@/lib/clips/logic";
import { sourceLabel } from "@/lib/clips/url";
import { DOWNLOAD_LIMITS, fileSize, linkProblem, type Download, type DownloadList } from "@/lib/downloads/schema";
import styles from "./download.module.css";

const until = (time: number) => new Date(time).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * The downloader's page: a link goes in, and the account's downloads are listed with how far
 * along each is, the file to save when it's ready, and a way into the editor with it.
 */
export function DownloadView() {
  const toast = useToast();
  const id = useId();
  const [list, setList] = useState<DownloadList | null>(null);
  const [unloaded, setUnloaded] = useState(false);
  const [url, setUrl] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const going = list?.downloads.some((d) => d.status === "queued" || d.status === "working") ?? false;

  useEffect(() => {
    const controller = new AbortController();
    api.downloads.list(controller.signal).then(setList, () => {
      if (!controller.signal.aborted) setUnloaded(true);
    });
    return () => controller.abort();
  }, []);

  // While something is being fetched, ask how it's going every few seconds.
  useEffect(() => {
    if (!going) return;
    const timer = setInterval(() => void api.downloads.list().then(setList, () => undefined), 2500);
    return () => clearInterval(timer);
  }, [going]);

  async function start(e: FormEvent) {
    e.preventDefault();
    const wrong = linkProblem(url);
    setProblem(wrong);
    if (wrong) return;
    setBusy(true);
    try {
      const made = await api.downloads.start(url.trim());
      setList((now) => ({ downloads: [made, ...(now?.downloads ?? []).filter((d) => d.id !== made.id)], leftToday: Math.max(0, (now?.leftToday ?? DOWNLOAD_LIMITS.perDay) - 1) }));
      setUrl("");
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(d: Download) {
    try {
      setList(await api.downloads.remove(d.id));
    } catch (err) {
      toast({ tone: "error", title: "Couldn’t remove it", body: err instanceof Error ? err.message : "Check your connection and try again." });
    }
  }

  const none = list !== null && list.leftToday <= 0;
  return (
    <main id="main" className={`container ${styles.page}`}>
      <header className={styles.head}>
        <h1 className="t-heading-xl">Download a video</h1>
        <p className="t-body-lg t-secondary">Paste a link from TikTok, Facebook, Twitch, Kick, Vimeo or another site, and save the video as an MP4. Free for every account.</p>
      </header>

      <form className={styles.form} onSubmit={(e) => void start(e)} noValidate>
        <div className="field">
          <label className="field-label" htmlFor={`${id}-url`}>
            Link to the video
          </label>
          <div className={styles.row}>
            <input
              id={`${id}-url`}
              className="input"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://www.tiktok.com/@name/video/…"
              maxLength={DOWNLOAD_LIMITS.url}
              value={url}
              disabled={busy}
              aria-invalid={problem ? true : undefined}
              aria-describedby={`${id}-help`}
              onChange={(e) => {
                setUrl(e.target.value);
                if (problem) setProblem(null);
              }}
            />
            <button className="btn btn-primary" type="submit" disabled={busy || none || url.trim() === ""} aria-busy={busy}>
              <DownloadSimple size={18} aria-hidden /> {busy ? "Looking…" : "Download"}
            </button>
          </div>
          <p id={`${id}-help`} className={problem ? "field-error" : "field-help"} role={problem ? "alert" : undefined}>
            {problem ??
              (none
                ? `That’s ${DOWNLOAD_LIMITS.perDay} downloads in a day, the most an account can start. Try again tomorrow.`
                : `Videos of up to ${DOWNLOAD_LIMITS.maxDurationSec / 60} minutes${list ? `, ${list.leftToday} more today` : ""}. Not YouTube: to clip a YouTube video, use Import.`)}
          </p>
        </div>
        <p className={styles.rights}>Only download videos you own or have permission to use. Files are kept for {DOWNLOAD_LIMITS.keepHours} hours, then deleted.</p>
        <p className={styles.rights}>Some sites, Instagram and Reddit among them, show videos only to people who are signed in. Bamio can’t fetch those.</p>
      </form>

      <section aria-labelledby={`${id}-list`} className={styles.listed}>
        <h2 id={`${id}-list`} className="t-heading-md">
          Your downloads
        </h2>
        {unloaded ? (
          <p className="notice is-warning">Your downloads couldn’t be loaded. Check your connection and reload the page.</p>
        ) : list === null ? (
          <p className={styles.waiting}>Looking…</p>
        ) : list.downloads.length === 0 ? (
          <div className="empty">
            <FilmSlate size={40} aria-hidden />
            <h3 className="empty-title">Nothing here yet</h3>
            <p>Paste a link above. The video shows up here when it’s ready to save.</p>
          </div>
        ) : (
          <ul className={styles.items}>
            {list.downloads.map((d) => (
              <Item key={d.id} download={d} onRemove={() => void remove(d)} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function Item({ download: d, onRemove }: { download: Download; onRemove: () => void }) {
  const percent = d.progress === null ? null : Math.round(d.progress * 100);
  return (
    <li className={styles.item} data-status={d.status}>
      <div className={styles.thumb}>
        {/* The site's own picture of the video, from its server. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {d.thumbnail ? <img src={d.thumbnail} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <FilmSlate size={24} aria-hidden />}
        <span className={styles.length}>{formatTimecode(d.durationSec)}</span>
      </div>
      <div className={styles.text}>
        <p className={styles.title}>{d.title}</p>
        <p className={styles.meta}>
          <a className={styles.origin} href={d.url} target="_blank" rel="noopener noreferrer">
            <LinkSimple size={14} aria-hidden /> {sourceLabel(d.platform, d.url)}
          </a>
          {d.sizeBytes ? <span>{fileSize(d.sizeBytes)}</span> : null}
        </p>
        <div className={styles.state} role="status">
          {d.status === "queued" ? <span>Waiting its turn…</span> : null}
          {d.status === "working" ? (
            <>
              <div className="progress" role="progressbar" aria-label={`Downloading ${d.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
                <span style={{ "--value": `${Math.max(3, percent ?? 3)}%` } as React.CSSProperties} />
              </div>
              <span>{percent === null ? "Downloading…" : `Downloading… ${percent}%`}</span>
            </>
          ) : null}
          {d.status === "ready" ? (
            <span className={styles.ready}>
              <CheckCircle size={16} weight="fill" aria-hidden /> Ready{d.expiresAt ? `, kept until ${until(d.expiresAt)}` : ""}
            </span>
          ) : null}
          {d.status === "failed" ? (
            <span className={styles.failed}>
              <Warning size={16} weight="fill" aria-hidden /> {d.error ?? "It couldn’t be downloaded."}
            </span>
          ) : null}
        </div>
      </div>
      <div className={styles.actions}>
        {d.status === "ready" ? (
          <>
            <a className="btn btn-primary btn-sm" href={downloadFileUrl(d.id)} download>
              <DownloadSimple size={16} aria-hidden /> Save the video
            </a>
            <Link className="btn btn-secondary btn-sm" href={`/editor?download=${d.id}&name=${encodeURIComponent(d.title.slice(0, 60))}`}>
              <PencilSimple size={16} aria-hidden /> Open in editor
            </Link>
          </>
        ) : null}
        <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Remove ${d.title}`} title={d.status === "queued" || d.status === "working" ? "Stop and remove" : "Remove"} onClick={onRemove}>
          <Trash size={16} aria-hidden />
        </button>
      </div>
    </li>
  );
}
