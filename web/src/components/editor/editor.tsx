"use client";

import { ArrowLeft, ArrowUUpLeft, ArrowUUpRight, CloudCheck, Export, Warning } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { MediaError, openAsset, type Asset } from "@/lib/editor/assets";
import { Engine } from "@/lib/editor/engine";
import type { EditorLevel } from "@/lib/editor/features";
import { EDITOR_LIMITS, type Edit } from "@/lib/editor/model";
import { pruneFiles, saveEdit, saveFile } from "@/lib/editor/store";
import { addMedia, duplicateItem, patchAudio, removeItem, splitAt } from "@/lib/editor/timeline";
import { ACCEPT_ALL, EditorContext, type EditorContextValue } from "./context";
import { ExportDialog } from "./export-dialog";
import { Preview } from "./preview";
import { SidePanel } from "./side-panel";
import { Timeline } from "./timeline";
import { useEdit } from "./use-edit";
import styles from "./editor.module.css";

/*
 * The editor: a preview, a timeline and a panel of tools around one edit. Everything happens in
 * this browser tab (see lib/editor/): the files are read from the device, the edit is saved in
 * the browser's own storage, and the export is rendered here. `firstFiles`: files to put in a
 * new edit straight away. `level`: the account's plan, which some features need.
 */
export function Editor({ initial, files, firstFiles, level, onClose }: { initial: Edit; files: ReadonlyMap<string, Blob>; firstFiles?: File[]; level: EditorLevel; onClose: () => void }) {
  const toast = useToast();
  const { edit, selection, canUndo, canRedo, change, select, undo, redo } = useEdit(initial);
  const [engine] = useState(() => new Engine());
  const [assets, setAssets] = useState<ReadonlyMap<string, Asset>>(new Map());
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set());
  const [drawn, redraw] = useReducer((n: number) => n + 1, 0);
  const [opening, setOpening] = useState(firstFiles?.length ?? 0);
  const [savedEdit, setSavedEdit] = useState(initial);
  const [saveFailed, setSaveFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [dropping, setDropping] = useState(false);

  const picker = useRef<HTMLInputElement>(null);
  const picking = useRef<{ replace?: string }>({});
  const latest = useRef(edit);
  const opened = useRef(new Set<Asset>());
  useEffect(() => {
    latest.current = edit;
  }, [edit]);

  /* ------------------------------ Files ------------------------------ */

  const addFiles = useCallback(
    async (list: File[], options?: { at?: number; volume?: number; select?: boolean }) => {
      if (list.length === 0) return;
      setOpening((n) => n + list.length);
      const added: Asset[] = [];
      for (const file of list) {
        try {
          const asset = await openAsset(file, file.name, redraw);
          opened.current.add(asset);
          added.push(asset);
          void saveFile(latest.current.id, asset.media.id, file.name, file).then((kept) => {
            if (!kept) toast({ tone: "info", title: "This device is short of space", body: `“${file.name}” works now, but you’ll be asked for it again next time.` });
          });
        } catch (err) {
          toast({ tone: "error", title: err instanceof MediaError ? err.message : `“${file.name}” couldn’t be opened.` });
        } finally {
          setOpening((n) => n - 1);
        }
      }
      if (added.length === 0) return;
      setAssets((before) => new Map([...before, ...added.map((a) => [a.media.id, a] as const)]));
      const before = latest.current;
      let next = addMedia(before, added.map((a) => a.media), options?.at ?? engine.time);
      const sounds = next.audio.filter((a) => !before.audio.some((b) => b.id === a.id));
      if (options?.volume !== undefined) for (const sound of sounds) next = patchAudio(next, sound.id, { volume: options.volume });
      change(next, options?.select && sounds[0] ? { selection: { kind: "audio", id: sounds[0].id } } : undefined);
    },
    [change, engine, toast],
  );

  /** Bring back a file the browser no longer has. */
  const replaceFile = useCallback(
    async (id: string, file: File) => {
      const media = latest.current.media.find((m) => m.id === id);
      if (!media) return;
      try {
        const asset = await openAsset(file, media.name, redraw, media);
        opened.current.add(asset);
        setAssets((before) => new Map([...before, [id, asset]]));
        setMissing((before) => new Set([...before].filter((m) => m !== id)));
        void saveFile(latest.current.id, id, media.name, file);
      } catch (err) {
        toast({ tone: "error", title: err instanceof MediaError ? err.message : `“${file.name}” couldn’t be opened.` });
      }
    },
    [toast],
  );

  const pickFiles = useCallback<EditorContextValue["pickFiles"]>((options) => {
    const input = picker.current;
    if (!input) return;
    picking.current = { replace: options?.replace };
    input.accept = options?.accept ?? ACCEPT_ALL;
    input.multiple = !options?.replace;
    input.value = "";
    input.click();
  }, []);

  // Open the files kept with the edit, then any it was started with.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const mine = opened.current;
    void (async () => {
      const found = new Map<string, Asset>();
      const lost = new Set<string>();
      for (const media of initial.media) {
        const blob = files.get(media.id);
        const asset = blob ? await openAsset(blob, media.name, redraw, media).catch(() => null) : null;
        if (asset) {
          mine.add(asset);
          found.set(media.id, asset);
        } else lost.add(media.id);
      }
      setAssets((before) => new Map([...found, ...before]));
      setMissing(lost);
      if (firstFiles?.length) {
        setOpening((n) => n - firstFiles.length);
        void addFiles(firstFiles);
      }
    })();
  }, [addFiles, files, firstFiles, initial]);

  useEffect(() => {
    const mine = opened.current;
    return () => {
      engine.dispose();
      for (const asset of mine) asset.dispose();
      mine.clear();
    };
  }, [engine]);

  /* ------------------------------ The preview follows the edit ------------------------------ */

  useEffect(() => {
    engine.setEdit(edit);
  }, [engine, edit]);
  useEffect(() => {
    engine.setAssets(assets);
  }, [engine, assets]);
  useEffect(() => {
    engine.selectText(selection?.kind === "text" ? selection.id : null);
  }, [engine, selection]);

  /* ------------------------------ Saving ------------------------------ */

  useEffect(() => {
    if (edit === savedEdit) return;
    const timer = setTimeout(() => {
      saveEdit(edit).then(
        () => {
          setSavedEdit(edit);
          setSaveFailed(false);
        },
        () => setSaveFailed(true),
      );
    }, 700);
    return () => clearTimeout(timer);
  }, [edit, savedEdit]);

  async function close() {
    engine.pause();
    await saveEdit(latest.current).catch(() => undefined);
    // Files of clips that were all deleted go too.
    const used = new Set([...latest.current.clips.map((c) => c.mediaId), ...latest.current.audio.map((a) => a.mediaId)]);
    await pruneFiles({ ...latest.current, media: latest.current.media.filter((m) => used.has(m.id)) }).catch(() => undefined);
    onClose();
  }

  /* ------------------------------ Keys ------------------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, dialog, [contenteditable=true]")) return;
      const command = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (command && key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (command && key === "y") {
        e.preventDefault();
        redo();
      } else if (command && key === "d") {
        e.preventDefault();
        const copy = duplicateItem(latest.current, selection);
        change(copy.edit, { selection: copy.selection });
      } else if (command || e.altKey) {
        return;
      } else if (e.key === " " && !target?.closest("button, a, [role=tab], [role=option]")) {
        e.preventDefault();
        engine.toggle();
      } else if (key === "s") {
        const cut = splitAt(latest.current, engine.time, selection);
        change(cut.edit, { selection: cut.selection });
      } else if ((e.key === "Delete" || e.key === "Backspace") && selection) {
        e.preventDefault();
        change(removeItem(latest.current, selection), { selection: null });
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (target?.closest("[role=tab], [role=slider], [role=option]")) return;
        e.preventDefault();
        engine.step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 30 : 1));
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        engine.pause();
        engine.seek(e.key === "Home" ? 0 : engine.total);
      } else if (e.key === "Escape") {
        select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [change, engine, redo, select, selection, undo]);

  const value = useMemo<EditorContextValue>(
    () => ({ edit, selection, change, select, engine, assets, missing, addFiles, pickFiles, drawn, level }),
    [edit, selection, change, select, engine, assets, missing, addFiles, pickFiles, drawn, level],
  );

  const saving = edit !== savedEdit;
  return (
    <EditorContext.Provider value={value}>
      <div
        className={`studio ${styles.shell}`}
        data-dropping={dropping ? "" : undefined}
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
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        <header className={styles.bar}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => void close()}>
            <ArrowLeft size={16} aria-hidden /> Edits
          </button>
          <input
            className={styles.name}
            aria-label="Name of this edit"
            value={edit.name}
            maxLength={EDITOR_LIMITS.name}
            onChange={(e) => change({ ...edit, name: e.target.value, updatedAt: Date.now() }, { key: "name" })}
          />
          <span className={styles.saveState} data-state={saveFailed ? "error" : undefined} role="status">
            {saveFailed ? (
              <>
                <Warning size={14} aria-hidden /> Not saved: this browser’s storage refused
              </>
            ) : saving ? (
              "Saving…"
            ) : (
              <>
                <CloudCheck size={14} aria-hidden /> Saved on this device
              </>
            )}
          </span>
          <div className={styles.barActions}>
            <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
              <ArrowUUpLeft size={18} aria-hidden />
            </button>
            <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
              <ArrowUUpRight size={18} aria-hidden />
            </button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => {
                engine.pause();
                setExporting(true);
              }}
            >
              <Export size={16} aria-hidden /> Export
            </button>
          </div>
        </header>

        <div className={styles.body}>
          <Preview opening={opening} />
          <SidePanel />
        </div>
        <Timeline />

        <input
          ref={picker}
          type="file"
          hidden
          data-testid="editor-files"
          onChange={(e) => {
            const list = [...(e.target.files ?? [])];
            const replace = picking.current.replace;
            if (replace && list[0]) void replaceFile(replace, list[0]);
            else void addFiles(list);
          }}
        />
        <ExportDialog open={exporting} onClose={() => setExporting(false)} />
      </div>
    </EditorContext.Provider>
  );
}
