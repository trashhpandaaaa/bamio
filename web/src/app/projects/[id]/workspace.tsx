"use client";

import { ArrowLeft, CheckCircle, CircleNotch, Export, WarningCircle } from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useRef } from "react";
import { useProject } from "@/hooks/use-project";
import { useSceneMedia } from "@/hooks/use-scene-media";
import { DirectorPanel } from "./director-panel";
import { EditPanel } from "./edit-panel";
import { ExportPanel } from "./export-panel";
import { StoryboardPanel } from "./storyboard-panel";
import styles from "./workspace.module.css";

const TABS = [
  { id: "storyboard", label: "Storyboard" },
  { id: "edit", label: "Edit" },
  { id: "director", label: "Director" },
  { id: "export", label: "Export" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function Workspace({ id }: { id: string }) {
  const { project, dispatch, load, save, saveNow } = useProject(id);
  const media = useSceneMedia(project, dispatch);
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const raw = params.get("tab");
  const tab: TabId = TABS.some((t) => t.id === raw) ? (raw as TabId) : "storyboard";

  const setTab = useCallback(
    (next: TabId) => router.replace(`${pathname}?tab=${next}`, { scroll: false }),
    [pathname, router],
  );

  if (load.state === "loading") {
    return (
      <div className={`container ${styles.page}`} aria-busy="true">
        <div className="skeleton" style={{ height: 40, width: 320 }} />
        <div className="skeleton" style={{ height: 44, width: "100%", maxWidth: 480 }} />
        <div className="skeleton" style={{ height: 360 }} />
      </div>
    );
  }

  if (load.state === "missing" || load.state === "error" || !project) {
    return (
      <div className={`container state-panel`}>
        <h1 className="t-heading-lg">{load.state === "error" ? "Couldn’t open this video" : "We can’t find this video"}</h1>
        <p>{load.state === "error" ? load.error : "It may have been deleted, or it was made in a different browser. Videos are saved on the device they were made on."}</p>
        <Link href="/projects" className="btn btn-primary">
          Back to your videos
        </Link>
      </div>
    );
  }

  return (
    <div className={`container ${styles.page}`}>
      <div className={styles.head}>
        <Link href="/projects" className="btn btn-ghost btn-icon" aria-label="Back to your videos">
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <input
          className={styles.title}
          type="text"
          name="title"
          autoComplete="off"
          aria-label="Video title"
          maxLength={80}
          value={project.title}
          onChange={(e) => dispatch({ type: "setTitle", title: e.target.value })}
          onBlur={(e) => {
            if (!e.target.value.trim()) dispatch({ type: "setTitle", title: "Untitled video" });
          }}
        />
        <span className={styles.save} aria-live="polite">
          {save === "saving" ? (
            <>
              <CircleNotch size={14} className="spin" aria-hidden /> Saving…
            </>
          ) : save === "error" ? (
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => void saveNow(project)}>
              <WarningCircle size={14} aria-hidden style={{ color: "var(--error)" }} /> Couldn’t save. Retry
            </button>
          ) : (
            <>
              <CheckCircle size={14} aria-hidden /> Saved
            </>
          )}
        </span>
        <button className={`btn btn-volt ${styles.exportBtn}`} type="button" onClick={() => setTab("export")}>
          <Export size={18} aria-hidden />
          Export
        </button>
      </div>

      <div className="tabs" role="tablist" aria-label="Video sections">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            id={`tab-${t.id}`}
            className="tab"
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
              if (!dir) return;
              e.preventDefault();
              const next = (i + dir + TABS.length) % TABS.length;
              setTab(TABS[next]!.id);
              tabRefs.current[next]?.focus();
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <section id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`} className={styles.panel}>
        {tab === "storyboard" ? <StoryboardPanel project={project} dispatch={dispatch} media={media} /> : null}
        {tab === "edit" ? <EditPanel project={project} dispatch={dispatch} media={media} /> : null}
        {tab === "director" ? <DirectorPanel project={project} dispatch={dispatch} onOpenTab={setTab} /> : null}
        {tab === "export" ? <ExportPanel project={project} dispatch={dispatch} media={media} /> : null}
      </section>
    </div>
  );
}

export type Media = ReturnType<typeof useSceneMedia>;
