import { editSchema, type Edit } from "./model";
import { totalDuration } from "./timeline";

/*
 * Where edits are kept: in the browser's own database (IndexedDB) on the user's device, the
 * document and the files it uses side by side. Nothing here goes to Bamio's servers. A browser
 * may refuse a large file when the device is short of space: the edit is still saved, and the
 * file is asked for again next time.
 */

const DB = "bamio-editor";
const EDITS = "edits";
const FILES = "files";

export type SavedEdit = { id: string; name: string; updatedAt: number; duration: number; clips: number };
type EditRow = SavedEdit & { edit: Edit };
type FileRow = { id: string; editId: string; name: string; blob: Blob };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EDITS)) db.createObjectStore(EDITS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: "id" }).createIndex("editId", "editId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The browser's storage couldn't be opened."));
  });
}

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("The browser's storage refused."));
  });

const finished = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("The browser's storage refused."));
    tx.onabort = () => reject(tx.error ?? new Error("The browser's storage refused."));
  });

/** The edits on this device, the newest first. */
export async function listEdits(): Promise<SavedEdit[]> {
  const db = await open();
  try {
    const rows = (await done(db.transaction(EDITS).objectStore(EDITS).getAll())) as EditRow[];
    return rows.map(({ id, name, updatedAt, duration, clips }) => ({ id, name, updatedAt, duration, clips })).sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function saveEdit(edit: Edit): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction(EDITS, "readwrite");
    const row: EditRow = { id: edit.id, name: edit.name, updatedAt: edit.updatedAt, duration: totalDuration(edit), clips: edit.clips.length, edit };
    tx.objectStore(EDITS).put(row);
    await finished(tx);
  } finally {
    db.close();
  }
}

/** Keep a file of an edit. False when the browser has no room for it (the edit still works until the page is closed). */
export async function saveFile(editId: string, id: string, name: string, blob: Blob): Promise<boolean> {
  try {
    const db = await open();
    try {
      const tx = db.transaction(FILES, "readwrite");
      tx.objectStore(FILES).put({ id, editId, name, blob } satisfies FileRow);
      await finished(tx);
      return true;
    } finally {
      db.close();
    }
  } catch {
    return false;
  }
}

/** An edit and the files kept for it (null when there's no such edit, or it can't be read any more). */
export async function loadEdit(id: string): Promise<{ edit: Edit; files: Map<string, Blob> } | null> {
  const db = await open();
  try {
    const row = (await done(db.transaction(EDITS).objectStore(EDITS).get(id))) as EditRow | undefined;
    const parsed = editSchema.safeParse(row?.edit);
    if (!parsed.success) return null;
    const rows = (await done(db.transaction(FILES).objectStore(FILES).index("editId").getAll(id))) as FileRow[];
    return { edit: parsed.data, files: new Map(rows.map((r) => [r.id, r.blob])) };
  } finally {
    db.close();
  }
}

export async function deleteEdit(id: string): Promise<void> {
  const db = await open();
  try {
    const tx = db.transaction([EDITS, FILES], "readwrite");
    tx.objectStore(EDITS).delete(id);
    const files = tx.objectStore(FILES);
    const keys = await done(files.index("editId").getAllKeys(id));
    for (const key of keys) files.delete(key);
    await finished(tx);
  } finally {
    db.close();
  }
}

/** Forget the files an edit no longer uses. */
export async function pruneFiles(edit: Edit): Promise<void> {
  const db = await open();
  try {
    const used = new Set(edit.media.map((m) => m.id));
    const tx = db.transaction(FILES, "readwrite");
    const files = tx.objectStore(FILES);
    const keys = (await done(files.index("editId").getAllKeys(edit.id))) as string[];
    for (const key of keys) if (!used.has(key)) files.delete(key);
    await finished(tx);
  } finally {
    db.close();
  }
}
