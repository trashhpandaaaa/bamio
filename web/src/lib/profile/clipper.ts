import { z } from "zod";

/*
 * The Clippers page (/clippers): what a user may show about themselves there, shared by the
 * profile form, the API and the page. A public name, one line about themselves, and a link
 * to their channel on a platform Bamio knows (so a card can't link just anywhere).
 */

export const CLIPPER_LIMITS = { nameMin: 2, name: 40, bio: 140, link: 200 } as const;

export const CLIPPER_PLATFORMS = {
  youtube: { name: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  twitch: { name: "Twitch", hosts: ["twitch.tv"] },
  kick: { name: "Kick", hosts: ["kick.com"] },
  tiktok: { name: "TikTok", hosts: ["tiktok.com"] },
  instagram: { name: "Instagram", hosts: ["instagram.com"] },
  x: { name: "X", hosts: ["x.com", "twitter.com"] },
} as const;
export type ClipperPlatform = keyof typeof CLIPPER_PLATFORMS;

export type ClipperLink = { url: string; platform: ClipperPlatform; handle: string };

/**
 * A channel link, tidied: https, a known platform, a path (a channel, not the site's front
 * page), no query or fragment. Null when it isn't one. "twitch.tv/name" works without https://.
 */
export function clipperLink(input: string): ClipperLink | null {
  const text = input.trim();
  if (!text || text.length > CLIPPER_LIMITS.link) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  const platform = (Object.keys(CLIPPER_PLATFORMS) as ClipperPlatform[]).find((p) => (CLIPPER_PLATFORMS[p].hosts as readonly string[]).includes(host));
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

/** Control characters, zero-width marks and Unicode line and space separators (by code point, so nothing invisible lives in this file). */
const odd = (code: number) => code <= 0x1f || code === 0x7f || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202f);

/** One line, with odd whitespace and control characters taken out. */
const tidy = (s: string) =>
  Array.from(s, (c) => (odd(c.codePointAt(0) ?? 0) ? " " : c))
    .join("")
    .replace(/\s+/g, " ")
    .trim();

/** What the profile form sends. `link`: empty for none. */
export const clipperInputSchema = z.object({
  name: z.string().max(200).transform(tidy).pipe(z.string().min(CLIPPER_LIMITS.nameMin, "Add a name of at least 2 characters.").max(CLIPPER_LIMITS.name, `Keep the name to ${CLIPPER_LIMITS.name} characters.`)),
  bio: z.string().max(1000).transform(tidy).pipe(z.string().max(CLIPPER_LIMITS.bio, `Keep the line about you to ${CLIPPER_LIMITS.bio} characters.`)),
  link: z
    .string()
    .max(CLIPPER_LIMITS.link)
    .transform((s) => s.trim())
    .refine((s) => s === "" || clipperLink(s) !== null, "Use a link to your channel on YouTube, Twitch, Kick, TikTok, Instagram or X."),
});
export type ClipperInput = z.infer<typeof clipperInputSchema>;

export type ClipperStatus = "pending" | "approved" | "hidden";

/** A user's own entry, as their profile shows it. */
export type MyClipper = { name: string; bio: string; link: string; status: ClipperStatus; imageUrl: string | null };

/** A card on the Clippers page. `clips`: clips they've exported with Bamio (in projects they still keep). */
export type ClipperCard = { name: string; bio: string; link: ClipperLink | null; imageUrl: string | null; clips: number };
