/*
 * The links campaigns take from users, shared by the forms, the API and the pages: a clipper's
 * channel, and a clip they posted. Both must be on a platform Bamio knows, so a page never
 * links just anywhere and Bamio never fetches an address a user made up.
 */

export const LINK_MAX = 300;

/* ------------------------------ A clipper's channel ------------------------------ */

export const CHANNEL_PLATFORMS = {
  youtube: { name: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  twitch: { name: "Twitch", hosts: ["twitch.tv"] },
  kick: { name: "Kick", hosts: ["kick.com"] },
  tiktok: { name: "TikTok", hosts: ["tiktok.com"] },
  instagram: { name: "Instagram", hosts: ["instagram.com"] },
  x: { name: "X", hosts: ["x.com", "twitter.com"] },
} as const;
export type ChannelPlatform = keyof typeof CHANNEL_PLATFORMS;

export type ChannelLink = { url: string; platform: ChannelPlatform; handle: string };

function parse(input: string): URL | null {
  const text = input.trim();
  if (!text || text.length > LINK_MAX) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  return url.username || url.password || url.port ? null : url;
}

/**
 * A channel link, tidied: https, a known platform, a path (a channel, not the site's front
 * page), no query or fragment. Null when it isn't one. "twitch.tv/name" works without https://.
 */
export function channelLink(input: string): ChannelLink | null {
  const url = parse(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const platform = (Object.keys(CHANNEL_PLATFORMS) as ChannelPlatform[]).find((p) => (CHANNEL_PLATFORMS[p].hosts as readonly string[]).includes(host));
  const path = url.pathname.replace(/\/+$/, "");
  if (!platform || path.length < 2 || !/^[\w@./~%-]+$/.test(path)) return null;
  // Handles can be in any script (so %-escapes are fine), but never hold spaces, quotes or brackets.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null; // a broken %-sequence
  }
  if (/[\s<>"'`\\]/.test(decoded)) return null;
  const last = (decoded.split("/").filter(Boolean).at(-1) ?? "").replace(/^@/, "");
  return { url: `https://${host === "twitter.com" ? "x.com" : host}${path}`, platform, handle: last.slice(0, 30) };
}

/* ------------------------------ A clip they posted ------------------------------ */

/**
 * Where campaign clips are posted. `counted`: Bamio can read the post's view count itself
 * (campaign-views.ts); the others need an admin to type it in. Instagram and X show views only
 * to signed-in people: yt-dlp gets a post's page from them, without its view count (checked
 * on real posts; flip the flag only after seeing a count come back).
 */
export const CLIP_PLATFORMS = {
  tiktok: { name: "TikTok", counted: true },
  youtube: { name: "YouTube Shorts", counted: true },
  instagram: { name: "Instagram Reels", counted: false },
  x: { name: "X", counted: false },
} as const;
export type ClipPlatform = keyof typeof CLIP_PLATFORMS;
export const CLIP_PLATFORM_IDS = Object.keys(CLIP_PLATFORMS) as ClipPlatform[];

/**
 * `key`: the platform and the post's id, the same however the link was written, so one post
 * can't be sent twice. `short`: a TikTok share link (vm.tiktok.com/...), which only says which
 * post it is once followed (resolveClipLink on the server).
 */
export type ClipLink = { url: string; platform: ClipPlatform; key: string; short: boolean };

const match = (value: string | null | undefined, re: RegExp) => (value && re.test(value) ? value : null);

/** A link to one post on TikTok, YouTube, Instagram or X, tidied. Null when it isn't one. */
export function clipLink(input: string): ClipLink | null {
  const url = parse(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "");
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "youtube.com" || host === "youtu.be") {
    const shorts = host === "youtube.com" && parts[0] === "shorts";
    const id = match(host === "youtu.be" ? parts[0] : shorts ? parts[1] : parts[0] === "watch" ? url.searchParams.get("v") : null, /^[\w-]{11}$/);
    if (!id) return null;
    return { url: shorts ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`, platform: "youtube", key: `youtube:${id}`, short: false };
  }

  if (host === "tiktok.com") {
    if (parts[0] === "t") {
      const code = match(parts[1], /^[A-Za-z0-9]{5,20}$/);
      return code ? { url: `https://www.tiktok.com/t/${code}/`, platform: "tiktok", key: `tiktok:t:${code}`, short: true } : null;
    }
    const name = match(parts[0]?.replace(/^@/, ""), /^[\w.]{1,32}$/);
    const id = match(parts[2], /^\d{6,25}$/);
    if (!parts[0]?.startsWith("@") || parts[1] !== "video" || !name || !id) return null;
    return { url: `https://www.tiktok.com/@${name}/video/${id}`, platform: "tiktok", key: `tiktok:${id}`, short: false };
  }
  if (host === "vm.tiktok.com" || host === "vt.tiktok.com") {
    const code = match(parts[0], /^[A-Za-z0-9]{5,20}$/);
    return code ? { url: `https://${host}/${code}/`, platform: "tiktok", key: `tiktok:t:${code}`, short: true } : null;
  }

  if (host === "instagram.com") {
    // instagram.com/reel/<code>, /reels/<code>, /p/<code>, or the same after a username.
    const at = parts.findIndex((p) => p === "reel" || p === "reels" || p === "p");
    const code = at === 0 || at === 1 ? match(parts[at + 1], /^[\w-]{5,40}$/) : null;
    return code ? { url: `https://www.instagram.com/reel/${code}/`, platform: "instagram", key: `instagram:${code}`, short: false } : null;
  }

  if (host === "x.com" || host === "twitter.com") {
    const at = parts.indexOf("status");
    const name = match(parts[0], /^\w{1,15}$/);
    const id = match(parts[at + 1], /^\d{5,25}$/);
    if (at < 1 || at > 2 || !name || !id) return null;
    return { url: `https://x.com/${name}/status/${id}`, platform: "x", key: `x:${id}`, short: false };
  }
  return null;
}
