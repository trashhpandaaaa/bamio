import "server-only";
import { canClip, planForClip, type ClipFeature, type ClipLevel } from "@/lib/clips/features";
import type { CaptionLook, ClipEdit } from "@/lib/clips/schema";
import { HttpError } from "@/lib/server/http";
import { planLevel } from "@/lib/server/plan-level";

/*
 * The clip side's paid features, refused on the server (lib/clips/features.ts says which plan
 * each needs). Clips are cut, rendered and translated here, so unlike the editor's browser
 * locks these hold: an edit that asks for something the account doesn't have is turned away
 * when it is saved, and again when it is exported, in case the plan lapsed in between.
 */

export const clipLevel = (userId: string): Promise<ClipLevel> => planLevel(userId);

/** True when a look asks for anything of its own (an empty look is the style's own). */
export const hasOwnLook = (look: CaptionLook | undefined): boolean =>
  Boolean(look) && Object.values(look!).some((v) => v !== undefined);

/** The paid features an edit uses. */
export function featuresUsed(edit: Partial<ClipEdit>): ClipFeature[] {
  const used: ClipFeature[] = [];
  if (edit.quality === "4k") used.push("uhd");
  if (edit.removeFillers) used.push("fillers");
  if (hasOwnLook(edit.look)) used.push("captionStyle");
  if (edit.focusPath && edit.focusPath.length > 0) used.push("faceTrack");
  if (edit.captionLanguage) used.push("translate");
  if (edit.logo && edit.logo !== "off") used.push("brandKit");
  return used;
}

/** How each feature reads in a sentence ("Pro adds 4K export."). */
const CLIP_LABEL: Record<ClipFeature, string> = {
  brandKit: "your brand kit",
  batch: "exporting every clip at once",
  uhd: "4K export",
  fillers: "filler-word removal",
  faceTrack: "AI face tracking",
  captionStyle: "caption styling of your own",
  translate: "captions in another language",
  team: "team members",
};

/** Refuse one feature by name, saying which plan it needs. */
export function refuse(feature: ClipFeature): never {
  throw new HttpError(402, "plan_required", `${planForClip(feature)} adds ${CLIP_LABEL[feature]}. Choose a plan to use it.`);
}

/** Throws unless the account's plan covers everything `edit` asks for. */
export async function assertClipEdit(userId: string, edit: Partial<ClipEdit>): Promise<void> {
  const used = featuresUsed(edit);
  if (used.length === 0) return;
  const level = await clipLevel(userId);
  const missing = used.find((feature) => !canClip(level, feature));
  if (missing) refuse(missing);
}

/** Throws unless the account's plan covers `feature` (for the routes that are one feature each). */
export async function assertClipFeature(userId: string, feature: ClipFeature): Promise<void> {
  if (!canClip(await clipLevel(userId), feature)) refuse(feature);
}
