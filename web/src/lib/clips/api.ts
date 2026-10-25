import type { AdCreditState, AdView } from "@/lib/ads";
import type { BillingState, Interval, PlanId, ReferralState } from "@/lib/billing/plans";
import type { CampaignInput, CampaignRequestInput, ClipperInput, JoinedCampaign, MyCampaign, MyCampaignRequest, MyClipper } from "@/lib/campaigns/schema";
import type {
  ClipEdit,
  ClipLength,
  InspectResult,
  Language,
  Project,
  SystemStatus,
  Transcript,
} from "@/lib/clips/schema";
import type { SubtitleFormat } from "@/lib/clips/schema";
import type { Download, DownloadList } from "@/lib/downloads/schema";
import type { BrandKit, BrandLook } from "@/lib/clips/brand";
import type { CaptionJob } from "@/lib/server/editor-captions";
import type { EditorSource } from "@/lib/server/editor-source";
import type { TeamMember } from "@/lib/server/teams";

/** What /api/team tells the billing page: the owner's list, and whether this account is on someone's team. */
export type TeamState = { seats: number; members: TeamMember[]; onTeam: boolean };

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
    // A Blob goes as it is (a sound for captions), form data as a form (the browser sets its type); anything else as JSON.
    const raw = body instanceof Blob;
    const form = typeof FormData !== "undefined" && body instanceof FormData;
    res = await fetch(url, {
      method,
      signal,
      headers: body === undefined || form ? undefined : { "Content-Type": raw ? body.type || "application/octet-stream" : "application/json" },
      body: body === undefined ? undefined : raw || form ? body : JSON.stringify(body),
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
const campaignBase = (slug: string) => `/api/campaigns/${encodeURIComponent(slug)}`;

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
  /** `lang`: one of the project's translations, instead of the spoken language. */
  transcript: (id: string, signal?: AbortSignal, lang?: string) =>
    request<Transcript>("GET", `${base(id)}/transcript${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`, undefined, signal),
  updateSegment: (id: string, index: number, text: string) => request<{ transcriptRev: number }>("PATCH", `${base(id)}/transcript`, { index, text }),
  findClips: (id: string, clipLength: ClipLength) => request<Project>("POST", `${base(id)}/find-clips`, { clipLength }),
  retranscribe: (id: string, language?: Language) => request<Project>("POST", `${base(id)}/retranscribe`, language ? { language } : undefined),
  stopRecording: (id: string) => request<Project>("POST", `${base(id)}/stop-recording`),
  addClip: (id: string, input: { start: number; end: number; title?: string }) => request<{ project: Project; clipId: string }>("POST", `${base(id)}/clips`, input),
  updateClip: (id: string, clipId: string, patch: ClipPatch) => request<Project>("PATCH", `${base(id)}/clips/${encodeURIComponent(clipId)}`, patch),
  deleteClip: (id: string, clipId: string) => request<Project>("DELETE", `${base(id)}/clips/${encodeURIComponent(clipId)}`),
  exportClip: (id: string, clipId: string) => request<Project>("POST", `${base(id)}/clips/${encodeURIComponent(clipId)}/export`),
  /** Render every clip of a project at once (Starter). The clips' own states carry the progress. */
  exportAll: (id: string, clipIds?: string[]) =>
    request<{ queued: number; failed: { clipId: string; error: string }[] }>("POST", `${base(id)}/export-all`, clipIds?.length ? { clipIds } : {}),
  /** Captions in another language (Pro): the languages a project has, and asking for one more. */
  translations: {
    list: (id: string, signal?: AbortSignal) => request<{ languages: string[] }>("GET", `${base(id)}/translate`, undefined, signal),
    add: (id: string, language: string) => request<Project>("POST", `${base(id)}/translate`, { language }),
    remove: (id: string, language: string) => request<{ languages: string[] }>("DELETE", `${base(id)}/translate?lang=${encodeURIComponent(language)}`),
  },
  /** The account's brand kit (Starter): the caption look and logo new clips start with. */
  brand: {
    get: (signal?: AbortSignal) => request<BrandKit>("GET", "/api/brand", undefined, signal),
    save: (look: BrandLook) => request<BrandKit>("PUT", "/api/brand", look),
    saveLogo: (logo: Blob) => request<BrandKit>("POST", "/api/brand", logo),
    removeLogo: () => request<BrandKit>("DELETE", "/api/brand"),
  },
  /** The Team plan's members (Team). Each change answers with the list as it is now. */
  team: {
    get: (signal?: AbortSignal) => request<TeamState>("GET", "/api/team", undefined, signal),
    invite: (email: string) => request<TeamState>("POST", "/api/team", { email }),
    remove: (email: string) => request<TeamState>("DELETE", "/api/team", { email }),
  },
  /** `fresh`: read the plan from Stripe first (back from Checkout or the billing portal). */
  billing: (opts: { fresh?: boolean; signal?: AbortSignal } = {}) => request<BillingState>("GET", opts.fresh ? "/api/billing?fresh=1" : "/api/billing", undefined, opts.signal),
  /** The user's referral link and what it has earned. */
  referrals: () => request<ReferralState>("GET", "/api/referrals"),
  /** The Stripe Checkout page to send the browser to. */
  checkout: (plan: PlanId, interval: Interval) => request<{ url: string }>("POST", "/api/billing/checkout", { plan, interval }),
  /** The free first video's card check: the Stripe page to send the browser to (the card is saved, never charged), then, back from it, tying the card to the trial. */
  trialCard: {
    start: (input: { from: "new" | "billing"; link?: string }) => request<{ url: string }>("POST", "/api/billing/trial-card", input),
    confirm: (sessionId: string) => request<BillingState>("POST", "/api/billing/trial-card/confirm", { sessionId }),
  },
  /** The Stripe billing portal page to send the browser to; with a plan, it opens on switching to it. */
  billingPortal: (target?: { plan: PlanId; interval: Interval }) => request<{ url: string }>("POST", "/api/billing/portal", target ?? {}),
  /** AI minutes earned by watching ads: the balance, and the two steps of earning more (offer a view, then claim it). */
  adCredits: {
    get: (signal?: AbortSignal) => request<AdCreditState>("GET", "/api/ads/reward", undefined, signal),
    start: () => request<AdView>("POST", "/api/ads/reward", { action: "start" }),
    claim: (id: string) => request<AdCreditState>("POST", "/api/ads/reward", { action: "claim", id }),
  },
  /** Who the user is in campaigns (null: they've never joined one): the name and channel shown, and how to pay them. */
  clipper: {
    get: (signal?: AbortSignal) => request<MyClipper | null>("GET", "/api/clipper", undefined, signal),
    save: (input: ClipperInput) => request<MyClipper>("PUT", "/api/clipper", input),
  },
  /** Clipping campaigns (/clippers), for the signed-in clipper. Each change answers with their new place in the campaign. */
  campaigns: {
    mine: (signal?: AbortSignal) => request<JoinedCampaign[]>("GET", "/api/campaigns/mine", undefined, signal),
    me: (slug: string, signal?: AbortSignal) => request<MyCampaign>("GET", `${campaignBase(slug)}/me`, undefined, signal),
    join: (slug: string, input: ClipperInput) => request<MyCampaign>("POST", `${campaignBase(slug)}/join`, input),
    sendClip: (slug: string, url: string) => request<MyCampaign>("POST", `${campaignBase(slug)}/clips`, { url }),
    withdrawClip: (slug: string, clipId: number) => request<MyCampaign>("DELETE", `${campaignBase(slug)}/clips/${clipId}`),
    /** Screenshots of where the clipper's audience is, replacing any sent before. */
    sendProof: (slug: string, images: File[]) => {
      const form = new FormData();
      for (const image of images) form.append("images", image);
      return request<MyCampaign>("POST", `${campaignBase(slug)}/proof`, form);
    },
  },
  /** Asking to run a campaign (the "Run a campaign" form on /clippers). Each answers with the user's requests as they are now. */
  campaignRequests: {
    mine: (signal?: AbortSignal) => request<MyCampaignRequest[]>("GET", "/api/campaign-requests", undefined, signal),
    send: (input: CampaignRequestInput) => request<MyCampaignRequest[]>("POST", "/api/campaign-requests", input),
    withdraw: (id: number) => request<MyCampaignRequest[]>("DELETE", `/api/campaign-requests/${id}`),
  },
  /** The downloader (/download): videos fetched from links, kept a day. */
  downloads: {
    list: (signal?: AbortSignal) => request<DownloadList>("GET", "/api/downloads", undefined, signal),
    start: (url: string) => request<Download>("POST", "/api/downloads", { url }),
    /** Take one off the list and delete its file. Answers with the list as it is now. */
    remove: (id: string) => request<DownloadList>("DELETE", `/api/downloads/${encodeURIComponent(id)}`),
  },
  /** The editor's calls to the server: only for these features, never for its files. */
  editor: {
    /** A Bamio clip cut out for the editor, with its captions as words (Starter). */
    source: (projectId: string, clipId: string) => request<EditorSource>("POST", `${base(projectId)}/clips/${encodeURIComponent(clipId)}/editor`),
    /** Auto captions (Pro): the sound of what an edit uses, as a WAV. */
    captions: (sound: Blob, language: string, signal?: AbortSignal) => request<{ id: string }>("POST", `/api/editor/captions?language=${encodeURIComponent(language)}`, sound, signal),
    captionJob: (id: string, signal?: AbortSignal) => request<CaptionJob>("GET", `/api/editor/captions/${encodeURIComponent(id)}`, undefined, signal),
  },
  /** Delete the signed-in account and everything in it. */
  deleteAccount: () => request<void>("DELETE", "/api/account", { confirm: "delete" }),
  /** The admin panel’s changes (the server checks the role). */
  admin: {
    grantPlan: (userId: string, plan: PlanId | null) => request<{ ok: true }>("POST", `/api/admin/users/${encodeURIComponent(userId)}/plan`, { plan }),
    job: (id: number, action: "retry" | "cancel") => request<{ ok: true }>("POST", `/api/admin/jobs/${id}`, { action }),
    addAdmin: (email: string) => request<{ userId: string; email: string }>("POST", "/api/admin/admins", { email }),
    removeAdmin: (userId: string) => request<{ ok: true }>("DELETE", `/api/admin/admins/${encodeURIComponent(userId)}`),
    /** `requestId`: the request to run a campaign this one is made from. */
    createCampaign: (campaign: CampaignInput, requestId?: number) => request<{ id: string; slug: string }>("POST", "/api/admin/campaigns", { campaign, ...(requestId ? { requestId } : {}) }),
    declineCampaignRequest: (id: number, note: string) => request<{ ok: true }>("POST", `/api/admin/campaign-requests/${id}`, { action: "decline", note }),
    updateCampaign: (id: string, campaign: CampaignInput) => request<{ ok: true }>("PATCH", `/api/admin/campaigns/${encodeURIComponent(id)}`, { campaign }),
    campaignStatus: (id: string, status: "live" | "paused" | "ended") => request<{ ok: true }>("PATCH", `/api/admin/campaigns/${encodeURIComponent(id)}`, { status }),
    deleteCampaign: (id: string) => request<{ ok: true }>("DELETE", `/api/admin/campaigns/${encodeURIComponent(id)}`),
    /** Approve or reject a clip, type in its views (null: back to Bamio's count), or have them read again. */
    campaignClip: (clipId: number, change: { action: "approve" } | { action: "reject"; note: string } | { action: "views"; views: number | null } | { action: "recount" }) =>
      request<{ ok: true }>("POST", `/api/admin/campaign-clips/${clipId}`, change),
    /** Write down a payment Bamio made to a clipper. */
    payout: (campaignId: string, userId: string, amountCents: number, note: string) =>
      request<{ ok: true }>("POST", `/api/admin/campaigns/${encodeURIComponent(campaignId)}/payouts`, { userId, amountCents, note }),
    clipper: (userId: string, action: "block" | "unblock") => request<{ ok: true }>("POST", `/api/admin/clippers/${encodeURIComponent(userId)}`, { action }),
    /** Accept a clipper's audience proof, or reject it with a word about why. */
    proof: (campaignId: string, userId: string, accept: boolean, note = "") =>
      request<{ ok: true }>("POST", `/api/admin/campaigns/${encodeURIComponent(campaignId)}/proof/${encodeURIComponent(userId)}`, { accept, note }),
  },
};

/** Errors a plan can fix (no plan yet, minutes used up, as many projects as the plan keeps): worth a link to Pricing. */
export const isPlanError = (err: unknown) => err instanceof ApiError && ((err.status === 402 && err.code !== "card_required") || err.code === "too_many");

/** A finished download's file, to save; `view`: to read in the browser (the editor). */
export const downloadFileUrl = (id: string, view = false) => `/api/downloads/${encodeURIComponent(id)}/file${view ? "?view=1" : ""}`;

export const sourceUrl = (id: string) => `${base(id)}/source`;
/** A clip's cut for the editor (made by api.editor.source). */
export const editorCutUrl = (id: string, clipId: string) => `${base(id)}/clips/${encodeURIComponent(clipId)}/editor/file`;
/** A followed stream's video while it grows (HLS). */
export const liveUrl = (id: string) => `${base(id)}/live/source.m3u8`;
export const thumbUrl = (id: string, t?: number) => (t === undefined ? `${base(id)}/thumb` : `${base(id)}/thumb?t=${Math.max(0, Math.round(t * 10) / 10)}`);
export const exportUrl = (id: string, clipId: string, version: number | undefined, view = false) =>
  `${base(id)}/clips/${encodeURIComponent(clipId)}/export?v=${version ?? 0}${view ? "&view=1" : ""}`;
/** Every finished export of a project as one zip (Starter). */
export const exportAllUrl = (id: string) => `${base(id)}/export-all`;
/** A clip's captions as a subtitle file; `lang` for one of the project's translations. */
export const clipSubtitlesUrl = (id: string, clipId: string, format: SubtitleFormat, lang?: string) =>
  `${base(id)}/clips/${encodeURIComponent(clipId)}/subtitles?format=${format}${lang ? `&lang=${encodeURIComponent(lang)}` : ""}`;
/** The whole video's transcript as a subtitle or text file. */
export const transcriptFileUrl = (id: string, format: SubtitleFormat, lang?: string) =>
  `${base(id)}/transcript/file?format=${format}${lang ? `&lang=${encodeURIComponent(lang)}` : ""}`;
/** The account's own brand logo (for the clip editor's preview). */
export const brandLogoUrl = (at: number) => `/api/brand/logo?v=${at}`;

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
