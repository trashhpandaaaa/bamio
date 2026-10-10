import { z } from "zod";
import type { Platform } from "@/lib/clips/schema";
import { parseVideoUrl } from "@/lib/clips/url";

/*
 * The downloader (/download): paste a link to a video on another site and save the file. Free
 * for every signed-in account. Bamio's server fetches the video the way an import does
 * (yt-dlp), keeps it for a day so it can be saved, then deletes it.
 *
 * It doesn't take YouTube links (the user's decision, 2026-10-10): Google doesn't allow its ads
 * on a site that lets people download YouTube videos, and Bamio shows Google's ads. A YouTube
 * link can still be imported for clipping, as before. Never take that block out, or let a
 * redirect or a short link around it, without the user asking: the check is made on the link
 * as pasted and again on the page the site says it is (blockedSite, here; downloads.ts asks).
 */

export const DOWNLOAD_LIMITS = {
  /** The longest video, in seconds: the file sits on the server's disk for a day. */
  maxDurationSec: 60 * 60,
  /** New downloads an account may start in 24 hours. */
  perDay: 20,
  /** Downloads an account may have waiting or running at once. */
  atOnce: 3,
  /** Hours a finished file is kept before it's deleted. */
  keepHours: 24,
  url: 2000,
} as const;

export type DownloadStatus = "queued" | "working" | "ready" | "failed";

/** A download, as its owner sees it. */
export type Download = {
  id: string;
  /** The video's page. */
  url: string;
  title: string;
  platform: Platform;
  durationSec: number;
  thumbnail: string | null;
  status: DownloadStatus;
  /** 0 to 1 while it's being fetched, when the site says how far along it is. */
  progress: number | null;
  /** Why it failed, in words for the person who asked. */
  error: string | null;
  sizeBytes: number | null;
  createdAt: number;
  /** When the finished file is deleted. */
  expiresAt: number | null;
};

/** What the page shows: the account's downloads, and how many more it may start today. */
export type DownloadList = { downloads: Download[]; leftToday: number };

export const downloadRequestSchema = z.object({
  url: z.string().trim().min(1, "Paste a link to a video.").max(DOWNLOAD_LIMITS.url, "That link is too long."),
});

export const NO_YOUTUBE = "Bamio doesn’t download from YouTube. To clip a YouTube video, paste the link under Import instead.";

/** Hosts that are YouTube: its sites, its short links, and the servers its video files come from. */
const YOUTUBE_HOSTS = ["youtube.com", "youtu.be", "youtube-nocookie.com", "youtubekids.com", "googlevideo.com", "ytimg.com"];

/** Why the downloader won't take this address, or null when it will. */
export function blockedSite(url: URL): string | null {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return YOUTUBE_HOSTS.some((site) => host === site || host.endsWith(`.${site}`)) ? NO_YOUTUBE : null;
}

/** A pasted link, checked before anything is asked of the server: a message for what's wrong with it, or null. */
export function linkProblem(input: string): string | null {
  const check = parseVideoUrl(input);
  if (!check.ok) return check.message;
  return blockedSite(check.url);
}

/** "12.4 MB", "1.2 GB". */
export function fileSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`;
}
