import type { BillingState, Interval, PlanId, ReferralState } from "@/lib/billing/plans";
import type { MyClipper } from "@/lib/profile/clipper";
import type {
  ClipEdit,
  ClipLength,
  InspectResult,
  Language,
  Project,
  SystemStatus,
  Transcript,
} from "@/lib/clips/schema";

/* Browser client for the /api routes. Errors carry the server's user-facing message. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new ApiError(0, "offline", "Can’t reach Bamio. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    const fallback = res.status === 401 ? "Your session ended. Sign in again." : "Something went wrong. Try again.";
    throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? fallback);
  }
  return data as T;
}

const base = (id: string) => `/api/projects/${encodeURIComponent(id)}`;

export type ClipPatch = { title?: string; start?: number; end?: number; edit?: Partial<ClipEdit> };

export const api = {
  status: (signal?: AbortSignal) => request<SystemStatus>("GET", "/api/system/status", undefined, signal),
  inspect: (url: string, signal?: AbortSignal) => request<InspectResult>("POST", "/api/sources/inspect", { url }, signal),
  projects: (signal?: AbortSignal) => request<Project[]>("GET", "/api/projects", undefined, signal),
  createFromUrl: (input: {
    url: string;
    range?: { start: number; end: number };
    live?: { follow?: boolean; rewindSec: number; recordSec: number };
    findClips: boolean;
    clipLength: ClipLength;
    language: Language;
    edit?: Partial<ClipEdit>;
  }) =>
    request<Project>("POST", "/api/projects", input),
  createUpload: (input: { fileName: string; size: number; findClips: boolean; clipLength: ClipLength; language: Language; edit?: Partial<ClipEdit> }) =>
    request<{ project: Project; chunkBytes: number }>("POST", "/api/projects/upload", input),
  project: (id: string, signal?: AbortSignal) => request<Project>("GET", base(id), undefined, signal),
  renameProject: (id: string, title: string) => request<Project>("PATCH", base(id), { title }),
  applyLook: (id: string, clipId: string) => request<Project>("PATCH", base(id), { applyEditFrom: clipId }),
  deleteProject: (id: string) => request<void>("DELETE", base(id)),
  retry: (id: string) => request<Project>("POST", `${base(id)}/retry`),
  transcript: (id: string, signal?: AbortSignal) => request<Transcript>("GET", `${base(id)}/transcript`, undefined, signal),
  updateSegment: (id: string, index: number, text: string) => request<{ transcriptRev: number }>("PATCH", `${base(id)}/transcript`, { index, text }),
  findClips: (id: string, clipLength: ClipLength) => request<Project>("POST", `${base(id)}/find-clips`, { clipLength }),
  retranscribe: (id: string) => request<Project>("POST", `${base(id)}/retranscribe`),
  stopRecording: (id: string) => request<Project>("POST", `${base(id)}/stop-recording`),
  addClip: (id: string, input: { start: number; end: number; title?: string }) => request<{ project: Project; clipId: string }>("POST", `${base(id)}/clips`, input),
  updateClip: (id: string, clipId: string, patch: ClipPatch) => request<Project>("PATCH", `${base(id)}/clips/${encodeURIComponent(clipId)}`, patch),
  deleteClip: (id: string, clipId: string) => request<Project>("DELETE", `${base(id)}/clips/${encodeURIComponent(clipId)}`),
  exportClip: (id: string, clipId: string) => request<Project>("POST", `${base(id)}/clips/${encodeURIComponent(clipId)}/export`),
  /** `fresh`: read the plan from Stripe first (back from Checkout or the billing portal). */
  billing: (opts: { fresh?: boolean; signal?: AbortSignal } = {}) => request<BillingState>("GET", opts.fresh ? "/api/billing?fresh=1" : "/api/billing", undefined, opts.signal),
  /** The user's referral link and what it has earned. */
  referrals: () => request<ReferralState>("GET", "/api/referrals"),
  /** The Stripe Checkout page to send the browser to. */
  checkout: (plan: PlanId, interval: Interval) => request<{ url: string }>("POST", "/api/billing/checkout", { plan, interval }),
  /** The Stripe billing portal page to send the browser to; with a plan, it opens on switching to it. */
  billingPortal: (target?: { plan: PlanId; interval: Interval }) => request<{ url: string }>("POST", "/api/billing/portal", target ?? {}),
  /** The user's entry on the Clippers page: read it (null: not listed), save it (it then waits for approval), or take it down. */
  clipper: {
    get: (signal?: AbortSignal) => request<MyClipper | null>("GET", "/api/clipper", undefined, signal),
    save: (input: { name: string; bio: string; link: string }) => request<MyClipper>("PUT", "/api/clipper", input),
    remove: () => request<void>("DELETE", "/api/clipper"),
  },
  /** Delete the signed-in account and everything in it. */
  deleteAccount: () => request<void>("DELETE", "/api/account", { confirm: "delete" }),
  /** The admin panel’s changes (the server checks the role). */
  admin: {
    grantPlan: (userId: string, plan: PlanId | null) => request<{ ok: true }>("POST", `/api/admin/users/${encodeURIComponent(userId)}/plan`, { plan }),
    job: (id: number, action: "retry" | "cancel") => request<{ ok: true }>("POST", `/api/admin/jobs/${id}`, { action }),
    addAdmin: (email: string) => request<{ userId: string; email: string }>("POST", "/api/admin/admins", { email }),
    removeAdmin: (userId: string) => request<{ ok: true }>("DELETE", `/api/admin/admins/${encodeURIComponent(userId)}`),
    clipper: (userId: string, action: "approve" | "hide") => request<{ ok: true }>("POST", `/api/admin/clippers/${encodeURIComponent(userId)}`, { action }),
  },
};

/** Errors a plan can fix (no plan yet, minutes used up, as many projects as the plan keeps): worth a link to Pricing. */
export const isPlanError = (err: unknown) => err instanceof ApiError && (err.status === 402 || err.code === "too_many");

export const sourceUrl = (id: string) => `${base(id)}/source`;
/** A followed stream's video while it grows (HLS). */
export const liveUrl = (id: string) => `${base(id)}/live/source.m3u8`;
export const thumbUrl = (id: string, t?: number) => (t === undefined ? `${base(id)}/thumb` : `${base(id)}/thumb?t=${Math.max(0, Math.round(t * 10) / 10)}`);
export const exportUrl = (id: string, clipId: string, version: number | undefined, view = false) =>
  `${base(id)}/clips/${encodeURIComponent(clipId)}/export?v=${version ?? 0}${view ? "&view=1" : ""}`;

/**
 * Send a file in chunks with progress. Resumes from the server's count after a
 * dropped connection (up to 5 tries per chunk). Resolves when the last chunk is in.
 */
export async function uploadFile(
  id: string,
  file: File,
  chunkBytes: number,
  opts: { signal?: AbortSignal; onProgress?: (sent: number) => void },
): Promise<void> {
  let offset = 0;
  let failures = 0;
  while (offset < file.size) {
    if (opts.signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const chunk = file.slice(offset, Math.min(file.size, offset + chunkBytes));
    try {
      const result = await putChunk(`${base(id)}/upload?offset=${offset}`, chunk, opts.signal, (loaded) => opts.onProgress?.(offset + loaded));
      offset = result.received;
      failures = 0;
      opts.onProgress?.(offset);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      if (err instanceof ApiError && err.status !== 0 && err.status !== 409 && err.status < 500) throw err;
      if (++failures > 5) throw err;
      await new Promise((r) => setTimeout(r, 1000 * failures));
      // Ask where the server got to, then continue from there.
      const project = await api.project(id).catch(() => null);
      if (project?.upload) offset = project.upload.received;
      else if (err instanceof ApiError) throw err;
    }
  }
}

type ChunkBody = { received?: number; error?: { code?: string; message?: string } };

function parseBody(text: string): ChunkBody | null {
  try {
    return JSON.parse(text) as ChunkBody;
  } catch {
    return null;
  }
}

function putChunk(url: string, body: Blob, signal: AbortSignal | undefined, onProgress: (loaded: number) => void): Promise<{ received: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      const data = parseBody(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300 && typeof data?.received === "number") resolve({ received: data.received });
      else reject(new ApiError(xhr.status, data?.error?.code ?? "error", data?.error?.message ?? "The upload failed. Try again."));
    };
    xhr.onerror = () => reject(new ApiError(0, "offline", "The connection dropped during the upload."));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
