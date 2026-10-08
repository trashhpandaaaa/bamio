"use client";

import { FilmSlate, LockSimple, Plus, Trash, UploadSimple } from "@phosphor-icons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { exportUrl } from "@/lib/clips/api";
import { clock, newEdit, type Edit } from "@/lib/editor/model";
import { deleteEdit, listEdits, loadEdit, saveEdit, type SavedEdit } from "@/lib/editor/store";
import { ACCEPT_ALL } from "./context";
import { Editor } from "./editor";
import styles from "./editor.module.css";

type Open = { edit: Edit; files: ReadonlyMap<string, Blob>; firstFiles?: File[] };

const when = (time: number) => new Date(time).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/**
 * The editor's page: the edits kept in this browser and a way to start one, or the editor
 * itself with one open (?edit=<id>, so a reload comes back to it). Edits live on the device,
 * not in the account: another browser has its own.
 */
export function EditorApp() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const wanted = params.get("edit");
  const [edits, setEdits] = useState<SavedEdit[] | null>(null);
  const [open, setOpen] = useState<Open | null>(null);
  const [failed, setFailed] = useState(false);
  const [deleting, setDeleting] = useState<SavedEdit | null>(null);
  const [dropping, setDropping] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const refresh = () =>
    listEdits().then(setEdits, () => {
      setEdits([]);
      setFailed(true);
    });

  // The list, and the edit the address names.
  useEffect(() => {
    let gone = false;
    void (async () => {
      if (wanted && open?.edit.id !== wanted) {
        const found = await loadEdit(wanted).catch(() => null);
        if (gone) return;
        if (found) setOpen(found);
        else router.replace("/editor");
      }
      if (!wanted) {
        if (!gone) setOpen(null);
        await refresh();
      }
    })();
    return () => {
      gone = true;
    };
    // `open` is read, not followed: opening an edit sets both it and the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, router]);

  /** A new edit with these files in it, named `name` or after the first file. `replace`: instead of this address in the browser's history, not after it. */
  async function start(files: File[], replace = false, name?: string) {
    const first = name ?? files[0]?.name.replace(/\.[^.]+$/, "").slice(0, 60);
    const edit = newEdit(first || "Untitled edit");
    await saveEdit(edit).catch(() => undefined);
    setOpen({ edit, files: new Map(), firstFiles: files });
    if (replace) router.replace(`/editor?edit=${edit.id}`);
    else router.push(`/editor?edit=${edit.id}`);
  }

  // A clip exported in Bamio, sent here from its card ("Open in editor"): fetched from this
  // account's own exports (the address is built from the two ids, never taken from the link)
  // and put in a new edit. Going back from the editor doesn't fetch it a second time.
  const fromProject = params.get("project");
  const fromClip = params.get("clip");
  const bringing = !wanted && fromProject !== null && fromClip !== null;
  const brought = useRef(false);
  useEffect(() => {
    if (!bringing || brought.current) return;
    brought.current = true;
    const isId = (v: string | null): v is string => v !== null && /^[0-9a-f-]{36}$/i.test(v);
    void (async () => {
      try {
        if (!isId(fromProject) || !isId(fromClip)) throw new Error("not a clip");
        const res = await fetch(exportUrl(fromProject, fromClip, Number(params.get("v")) || 0), { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        // The edit takes the clip's title; the file a name a disk would take.
        const title = (params.get("name") || "").trim().slice(0, 60) || "Bamio clip";
        const fileName = title.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() || "Bamio clip";
        await start([new File([await res.blob()], `${fileName}.mp4`, { type: "video/mp4" })], true, title);
      } catch {
        toast({ tone: "error", title: "That clip couldn’t be opened here", body: "Export it again on its project page, then try once more." });
        router.replace("/editor");
      }
    })();
    // Once, for the link the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bringing]);

  if (bringing) {
    return (
      <main id="main" className={`container ${styles.home}`}>
        <p className={styles.waiting}>Bringing your clip over…</p>
      </main>
    );
  }
  if (wanted) {
    if (!open || open.edit.id !== wanted) {
      return (
        <main id="main" className={`container ${styles.home}`}>
          <p className={styles.waiting}>Opening your edit…</p>
        </main>
      );
    }
    return (
      <main id="main">
        <Editor key={open.edit.id} initial={open.edit} files={open.files} firstFiles={open.firstFiles} onClose={() => router.push("/editor")} />
      </main>
    );
  }

  return (
    <main
      id="main"
      className={`container ${styles.home}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(false);
        void start([...e.dataTransfer.files]);
      }}
    >
      <header className={styles.homeHead}>
        <h1 className="t-heading-xl">Editor</h1>
        <p>Cut, combine and finish videos right here in your browser: trim, text, music, speed, looks, and one-click silence removal. Free for every account.</p>
      </header>

      <div className={styles.drop} data-dropping={dropping ? "" : undefined}>
        <UploadSimple size={32} aria-hidden />
        <p className={styles.dropTitle}>Drop videos, photos or music here</p>
        <div className={styles.dropActions}>
          <button className="btn btn-primary btn-lg" type="button" onClick={() => picker.current?.click()}>
            <Plus size={18} aria-hidden /> Choose files
          </button>
          <button className="btn btn-secondary btn-lg" type="button" onClick={() => void start([])}>
            Start empty
          </button>
        </div>
        <p className={styles.private}>
          <LockSimple size={14} aria-hidden /> Your files stay on this device. Nothing is uploaded, and the export is made here too.
        </p>
        <input
          ref={picker}
          type="file"
          hidden
          multiple
          accept={ACCEPT_ALL}
          data-testid="editor-new-files"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            if (files.length) void start(files);
          }}
        />
      </div>

      <section aria-labelledby="edits-title" className={styles.saved}>
        <h2 id="edits-title" className="t-heading-md">
          Your edits on this device
        </h2>
        {failed ? <p className="notice is-warning">This browser won’t let Bamio keep edits (private windows often don’t). You can still edit and export; the edit is gone when the tab closes.</p> : null}
        {edits === null ? (
          <p className={styles.waiting}>Looking…</p>
        ) : edits.length === 0 ? (
          <div className="empty">
            <FilmSlate size={40} aria-hidden />
            <h3 className="empty-title">No edits yet</h3>
            <p>Start one above. It’s saved in this browser as you work, so you can close the tab and come back.</p>
          </div>
        ) : (
          <ul className={styles.edits}>
            {edits.map((e) => (
              <li key={e.id} className={styles.edit}>
                <button className={styles.editOpen} type="button" onClick={() => router.push(`/editor?edit=${e.id}`)}>
                  <b>{e.name || "Untitled edit"}</b>
                  <small>
                    {e.clips === 0 ? "Empty" : `${clock(e.duration, false)}, ${e.clips} ${e.clips === 1 ? "clip" : "clips"}`} · {when(e.updatedAt)}
                  </small>
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label={`Delete ${e.name || "Untitled edit"}`} onClick={() => setDeleting(e)}>
                  <Trash size={16} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this edit?"
        body={`“${deleting?.name || "Untitled edit"}” and the copies of its files kept in this browser will be deleted. Your original files aren’t touched.`}
        confirmLabel="Delete edit"
        destructive
        onConfirm={() => {
          if (!deleting) return;
          void deleteEdit(deleting.id).then(refresh, () => toast({ tone: "error", title: "That edit couldn’t be deleted" }));
        }}
        onClose={() => setDeleting(null)}
      />
    </main>
  );
}
