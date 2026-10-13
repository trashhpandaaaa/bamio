import { channelLink } from "./links";
import { countryName, outsideAudience, type Audience } from "./regions";

/*
 * Signs that a campaign clip or clipper needs a closer look, for admins. A flag never blocks
 * anything or changes what is earned: real clips go viral and real people travel. It says what
 * to check before approving a clip or paying someone.
 */

export type Flag = { kind: FlagKind; text: string };
export type FlagKind = "elsewhere" | "not_their_post" | "few_likes" | "jump" | "shared_payout" | "shared_channel" | "proof";

/** Under this share of likes for its views, a clip with VIEWS_FOR_LIKES views or more is flagged (real audiences like 2 to 10%). */
export const LIKES_SHARE = 0.003;
export const VIEWS_FOR_LIKES = 10_000;
/** A jump: this many views more, and this many times as many, within a day. */
export const JUMP = { views: 50_000, times: 10, withinMs: 24 * 3600_000 } as const;
/** View counts kept per clip, to see a jump. */
export const VIEW_LOG_SIZE = 30;

/** The views log with a new count (the oldest dropped past VIEW_LOG_SIZE). */
export function logViews(log: readonly (readonly [number, number])[], at: number, views: number | null): [number, number][] {
  const kept = log.map(([t, v]) => [t, v] as [number, number]);
  if (views === null || (kept.at(-1)?.[1] === views && at - kept.at(-1)![0] < JUMP.withinMs)) return kept.slice(-VIEW_LOG_SIZE);
  return [...kept, [at, views] as [number, number]].slice(-VIEW_LOG_SIZE);
}

/** The first sudden jump in a views log, if any. */
export function viewJump(log: readonly (readonly [number, number])[]): { from: number; to: number; hours: number } | null {
  for (let i = 1; i < log.length; i++) {
    const [t0, v0] = log[i - 1]!;
    const [t1, v1] = log[i]!;
    if (t1 - t0 <= JUMP.withinMs && v1 - v0 >= JUMP.views && v1 >= Math.max(1, v0) * JUMP.times) return { from: v0, to: v1, hours: Math.max(1, Math.round((t1 - t0) / 3600_000)) };
  }
  return null;
}

/** An account name as sites write it, to compare: no @, no case. */
const handle = (s: string) => s.trim().replace(/^@/, "").toLowerCase();

export type ClipFacts = {
  platform: string;
  /** The account that posted it, as the site says. */
  author: string | null;
  /** The clipper's own channel (their link). */
  channel: string | null;
  country: string | null;
  views: number;
  likes: number | null;
  viewLog: readonly (readonly [number, number])[];
};

export function clipFlags(clip: ClipFacts, audience: Audience): Flag[] {
  const flags: Flag[] = [];
  if (clip.country && outsideAudience(clip.country, audience)) flags.push({ kind: "elsewhere", text: `Sent from ${countryName(clip.country)}` });
  const channel = clip.channel ? channelLink(clip.channel) : null;
  // A YouTube channel linked by its id (/channel/UC...) has no handle to compare.
  const comparable = channel && channel.platform === clip.platform && !(channel.platform === "youtube" && !channel.handle.startsWith("@"));
  if (clip.author && channel && comparable && handle(channel.handle) !== handle(clip.author)) {
    flags.push({ kind: "not_their_post", text: `Posted by @${handle(clip.author)}, not their channel @${handle(channel.handle)}` });
  }
  if (clip.likes !== null && clip.views >= VIEWS_FOR_LIKES && clip.likes < clip.views * LIKES_SHARE) {
    flags.push({ kind: "few_likes", text: `${clip.likes.toLocaleString("en-US")} likes for ${clip.views.toLocaleString("en-US")} views` });
  }
  const jump = viewJump(clip.viewLog);
  if (jump) flags.push({ kind: "jump", text: `Views jumped from ${jump.from.toLocaleString("en-US")} to ${jump.to.toLocaleString("en-US")} in ${jump.hours} h` });
  return flags;
}

export type ClipperFacts = {
  country: string | null;
  proofRequired: boolean;
  proofStatus: "none" | "waiting" | "accepted" | "rejected";
  /** Other clipper accounts with the same payment details, or the same channel. */
  samePayout: number;
  sameChannel: number;
};

export function clipperFlags(c: ClipperFacts, audience: Audience): Flag[] {
  const flags: Flag[] = [];
  if (c.country && outsideAudience(c.country, audience)) flags.push({ kind: "elsewhere", text: `Joined from ${countryName(c.country)}` });
  if (c.samePayout > 0) flags.push({ kind: "shared_payout", text: `Same payment details as ${c.samePayout} other ${c.samePayout === 1 ? "account" : "accounts"}` });
  if (c.sameChannel > 0) flags.push({ kind: "shared_channel", text: `Same channel as ${c.sameChannel} other ${c.sameChannel === 1 ? "account" : "accounts"}` });
  if (c.proofRequired && c.proofStatus !== "accepted") {
    flags.push({ kind: "proof", text: c.proofStatus === "waiting" ? "Audience proof waiting for a look" : c.proofStatus === "rejected" ? "Audience proof rejected" : "No audience proof yet" });
  }
  return flags;
}

/** Payment details as written by different people, to compare: no case, no spaces, no "PayPal:" and the like in front. */
export const payoutKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/^\s*(paypal|wise|bank|iban|crypto|usdt|btc|eth|upi|venmo|cash ?app)\s*[:\-]?\s*/i, "")
    .replace(/\s+/g, "");
