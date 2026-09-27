import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { newId } from "@/lib/ids";
import { projectSchema, type Project } from "@/lib/project/schema";

/* Local-first storage: projects and their media live in this browser's IndexedDB. */

export type AssetKind = "image" | "audio";
export type Asset = {
  id: string;
  projectId: string;
  kind: AssetKind;
  mime: string;
  blob: Blob;
  createdAt: number;
};

interface BamioDB extends DBSchema {
  projects: { key: string; value: Project; indexes: { byUpdated: number } };
  assets: { key: string; value: Asset; indexes: { byProject: string } };
}

/** Before accounts existed, everything lived in one database with this name. */
const LEGACY_DB_NAME = "bamio";
let dbPromise: Promise<IDBPDatabase<BamioDB>> | null = null;
/** Each signed-in user gets their own database, so people sharing a browser never see each other's videos. */
let userScope: string | null = null;

export class StorageUnavailableError extends Error {
  constructor() {
    super("This browser is blocking local storage, so Bamio cannot save videos. Leave private browsing or allow site data.");
    this.name = "StorageUnavailableError";
  }
}

export class StorageUserError extends Error {
  constructor() {
    super("Sign in to open your videos.");
    this.name = "StorageUserError";
  }
}

const dbNameFor = (userId: string) => `bamio:${userId}`;

/** Point storage at a user's database. Call before any other storage function. */
export function setStorageUser(userId: string): void {
  if (userScope === userId) return;
  userScope = userId;
  const previous = dbPromise;
  dbPromise = null;
  void previous?.then((d) => d.close()).catch(() => undefined);
}

function openStore(name: string) {
  return openDB<BamioDB>(name, 1, {
    upgrade(database) {
      const projects = database.createObjectStore("projects", { keyPath: "id" });
      projects.createIndex("byUpdated", "updatedAt");
      const assets = database.createObjectStore("assets", { keyPath: "id" });
      assets.createIndex("byProject", "projectId");
    },
  });
}

function db(): Promise<IDBPDatabase<BamioDB>> {
  if (typeof indexedDB === "undefined") return Promise.reject(new StorageUnavailableError());
  if (!userScope) return Promise.reject(new StorageUserError());
  if (!dbPromise) {
    const promise: Promise<IDBPDatabase<BamioDB>> = openStore(dbNameFor(userScope)).catch((err: unknown) => {
      if (dbPromise === promise) dbPromise = null;
      throw err instanceof Error && err.name === "InvalidStateError" ? new StorageUnavailableError() : err;
    });
    dbPromise = promise;
  }
  return dbPromise;
}

/**
 * One-time move of videos made before sign-in (the shared "bamio" database) into the
 * current user's database. Returns how many videos were moved.
 */
export async function adoptLegacyProjects(): Promise<number> {
  if (!userScope || typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return 0;
  const existing = await indexedDB.databases();
  if (!existing.some((d) => d.name === LEGACY_DB_NAME)) return 0;
  const legacy = await openStore(LEGACY_DB_NAME);
  const [projects, assets] = await Promise.all([legacy.getAll("projects"), legacy.getAll("assets")]);
  legacy.close();
  if (projects.length > 0) {
    const target = await db();
    const tx = target.transaction(["projects", "assets"], "readwrite");
    await Promise.all([
      ...projects.map((p) => tx.objectStore("projects").put(p)),
      ...assets.map((a) => tx.objectStore("assets").put(a)),
      tx.done,
    ]);
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
  return projects.filter((p) => parseProject(p) !== null).length;
}

function parseProject(value: unknown): Project | null {
  const parsed = projectSchema.safeParse(value);
  if (!parsed.success) {
    console.warn("[bamio] Skipping a saved project that failed validation.", parsed.error.issues[0]);
    return null;
  }
  return parsed.data;
}

export async function listProjects(): Promise<Project[]> {
  const all = await (await db()).getAllFromIndex("projects", "byUpdated");
  return all.map(parseProject).filter((p): p is Project => p !== null).reverse();
}

export async function getProject(id: string): Promise<Project | null> {
  const value = await (await db()).get("projects", id);
  return value ? parseProject(value) : null;
}

export async function saveProject(project: Project): Promise<void> {
  await (await db()).put("projects", project);
}

export async function deleteProject(id: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["projects", "assets"], "readwrite");
  const assetKeys = await tx.objectStore("assets").index("byProject").getAllKeys(id);
  await Promise.all([
    tx.objectStore("projects").delete(id),
    ...assetKeys.map((key) => tx.objectStore("assets").delete(key)),
    tx.done,
  ]);
}

export async function putAsset(asset: Omit<Asset, "id" | "createdAt">): Promise<string> {
  const id = newId();
  await (await db()).put("assets", { ...asset, id, createdAt: Date.now() });
  return id;
}

export async function getAsset(id: string): Promise<Asset | undefined> {
  return (await db()).get("assets", id);
}

export async function deleteAsset(id: string): Promise<void> {
  await (await db()).delete("assets", id);
}

/** Copy a project and all of its media under new ids. */
export async function duplicateProject(id: string, titleSuffix = " (copy)"): Promise<Project | null> {
  const source = await getProject(id);
  if (!source) return null;
  const database = await db();
  const assets = await database.getAllFromIndex("assets", "byProject", id);
  const now = Date.now();
  const copyId = newId();
  const remap = new Map<string, string>();
  for (const asset of assets) remap.set(asset.id, newId());
  const copy: Project = {
    ...source,
    id: copyId,
    title: `${source.title}${titleSuffix}`.slice(0, 80),
    createdAt: now,
    updatedAt: now,
    lastExport: undefined,
    scenes: source.scenes.map((s) => ({
      ...s,
      id: newId(),
      imageId: s.imageId ? remap.get(s.imageId) : undefined,
      audioId: s.audioId ? remap.get(s.audioId) : undefined,
    })),
    notes: [],
    directorSummary: undefined,
  };
  const tx = database.transaction(["projects", "assets"], "readwrite");
  await Promise.all([
    ...assets.map((a) => tx.objectStore("assets").put({ ...a, id: remap.get(a.id)!, projectId: copyId, createdAt: now })),
    tx.objectStore("projects").put(copy),
    tx.done,
  ]);
  return copy;
}
