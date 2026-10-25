import { gate, LEVELS, TOP_LEVEL, type Level } from "@/lib/billing/levels";
import type { PlanId } from "@/lib/billing/plans";

/*
 * What clipping gives to whom. Everything the first version did stays as it was for every
 * account with a plan (or the free first video): finding clips, reframing by hand, captions
 * in over 100 languages, the three caption looks, a 1080p export. The features below need
 * the plan named here, from it up.
 *
 * Unlike the editor's table (lib/editor/features.ts), these are not browser locks: clips are
 * cut, rendered and translated on the server, so the server refuses them (lib/server/
 * clip-access.ts). The controls are shown with a note either way, so nobody meets a locked
 * feature only after waiting for a render.
 *
 * A feature's name here must be a line under the same plan in billing/plans.ts, not marked
 * `soon` (a test checks), so the pricing page and the app always say the same thing.
 */

export const CLIP_LEVELS = LEVELS;
export type ClipLevel = Level;
export { TOP_LEVEL };

export const CLIP_FEATURES = {
  brandKit: { needs: "starter", name: "Brand kit" },
  batch: { needs: "starter", name: "Export every clip at once" },
  uhd: { needs: "pro", name: "4K export" },
  fillers: { needs: "pro", name: "Filler-word removal" },
  faceTrack: { needs: "pro", name: "AI face tracking" },
  captionStyle: { needs: "pro", name: "Custom caption styling" },
  translate: { needs: "pro", name: "Captions in another language" },
  team: { needs: "team", name: "Up to 5 team members" },
} as const satisfies Record<string, { needs: PlanId; name: string }>;
export type ClipFeature = keyof typeof CLIP_FEATURES;

const clips = gate(CLIP_FEATURES);

/** Whether an account at `level` has `feature`. */
export const canClip = (level: ClipLevel, feature: ClipFeature): boolean => clips.can(level, feature);

/** The plan a feature starts at, by its name: "Starter", "Pro". */
export const planForClip = (feature: ClipFeature): string => clips.planFor(feature);

/** The features an edit uses that `level` doesn't have, so a route can refuse the lot at once. */
export const CLIP_FEATURE_NAMES = Object.fromEntries(Object.entries(CLIP_FEATURES).map(([k, v]) => [k, v.name])) as Record<ClipFeature, string>;
