import type { Platform } from "@/lib/clips/schema";

/* URL checks shared by the browser (early feedback) and the server (enforcement). */

export type UrlCheck = { ok: true; url: URL } | { ok: false; message: string };

export function parseVideoUrl(input: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, message: "That doesn’t look like a link. Paste the full address, starting with https://" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, message: "Only http and https links are supported." };
  }
  if (url.username || url.password) return { ok: false, message: "Links with a username or password aren’t supported." };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    return { ok: false, message: "That address isn’t on the public internet." };
  }
  if (isPrivateAddress(host)) return { ok: false, message: "That address isn’t on the public internet." };
  return { ok: true, url };
}

export function detectPlatform(url: URL): Platform {
  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtube-nocookie.com") return "youtube";
  if (host === "twitch.tv" || host.endsWith(".twitch.tv")) return "twitch";
  if (host === "kick.com" || host.endsWith(".kick.com")) return "kick";
  return "other";
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  twitch: "Twitch",
  kick: "Kick",
  upload: "Upload",
  other: "Web",
};

/** Other sites people paste links from, by the end of the host name. */
const SITE_NAMES: [string, string][] = [
  ["vimeo.com", "Vimeo"],
  ["tiktok.com", "TikTok"],
  ["instagram.com", "Instagram"],
  ["facebook.com", "Facebook"],
  ["fb.watch", "Facebook"],
  ["x.com", "X"],
  ["twitter.com", "X"],
  ["reddit.com", "Reddit"],
  ["redd.it", "Reddit"],
  ["dailymotion.com", "Dailymotion"],
  ["dai.ly", "Dailymotion"],
  ["rumble.com", "Rumble"],
  ["streamable.com", "Streamable"],
  ["bilibili.com", "Bilibili"],
  ["ted.com", "TED"],
  ["loom.com", "Loom"],
  ["archive.org", "Internet Archive"],
  ["drive.google.com", "Google Drive"],
  ["dropbox.com", "Dropbox"],
  ["soundcloud.com", "SoundCloud"],
  ["linkedin.com", "LinkedIn"],
  ["trovo.live", "Trovo"],
];

/** Where a video came from, by name: the platform, or for other sites the site's own name when it's a well-known one ("Web" otherwise). */
export function sourceLabel(platform: Platform, url?: string): string {
  if (platform !== "other" || !url) return PLATFORM_LABEL[platform];
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return PLATFORM_LABEL.other;
  }
  return SITE_NAMES.find(([site]) => host === site || host.endsWith(`.${site}`))?.[1] ?? PLATFORM_LABEL.other;
}

/**
 * Another address for the same video that a server can read when it can't read the page:
 * Vimeo's pages answer only signed-in browsers, its player answers anyone (an unlisted
 * video's key goes along as ?h=). Null when there's none.
 */
export function playerUrl(url: URL): URL | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "vimeo.com") return null;
  const video = /^\/(?:channels\/[^/]+\/|groups\/[^/]+\/videos\/|album\/\d+\/video\/|showcase\/\d+\/video\/)?(\d+)(?:\/([0-9a-f]{6,40}))?\/?$/.exec(url.pathname);
  if (!video) return null;
  const player = new URL(`https://player.vimeo.com/video/${video[1]}`);
  const key = video[2] ?? url.searchParams.get("h");
  if (key && /^[0-9a-f]{6,40}$/.test(key)) player.searchParams.set("h", key);
  return player;
}

/**
 * True for IP literals in loopback, private, link-local, CGNAT, multicast or reserved
 * ranges (IPv4 and IPv6). Hostnames return false here; the server also resolves them.
 */
export function isPrivateAddress(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (h.includes(":")) {
    if (h === "::" || h === "::1") return true;
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
    if (mapped) return isPrivateAddress(mapped[1]!);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(h);
  }
  return false;
}
