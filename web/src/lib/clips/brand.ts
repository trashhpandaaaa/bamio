import { z } from "zod";
import { captionLookSchema, CAPTION_POSITIONS, CAPTION_STYLES, FRAMINGS, LOGO_SPOTS, type ClipEdit } from "@/lib/clips/schema";

/*
 * A brand kit (Starter): the caption look and the logo an account's new clips start with, so a
 * channel's clips look like each other without anyone setting the same six controls every time.
 *
 * The shape and the arithmetic live here, shared by the browser and the server; reading and
 * writing it (and the logo's bytes) is lib/server/brand.ts.
 *
 * Only the parts of an edit that are a *look* are saved. A clip's own times, title text and
 * aspect are its own business, and copying them between videos would be a surprise; "Use this
 * look for all clips" on a project already copies within one video.
 */

export const brandLookSchema = z.object({
  framing: z.enum(FRAMINGS).optional(),
  captions: z.boolean().optional(),
  captionStyle: z.enum(CAPTION_STYLES).optional(),
  captionPosition: z.enum(CAPTION_POSITIONS).optional(),
  look: captionLookSchema.optional(),
  logo: z.enum(LOGO_SPOTS).optional(),
});
export type BrandLook = z.infer<typeof brandLookSchema>;

export const brandKitSchema = z.object({
  version: z.literal(1),
  look: brandLookSchema,
  /** Set once a logo has been uploaded: the extension names the stored file. */
  logo: z.object({ ext: z.string().max(8), bytes: z.number().int().min(1), at: z.number() }).optional(),
  updatedAt: z.number(),
});
export type BrandKit = z.infer<typeof brandKitSchema>;

export const EMPTY_KIT: BrandKit = { version: 1, look: {}, updatedAt: 0 };

/** A clip edit with the brand kit laid over it (the kit wins: this is "apply my brand kit"). */
export function withBrand(edit: ClipEdit, kit: BrandKit): ClipEdit {
  const { look, ...rest } = kit.look;
  return { ...edit, ...rest, ...(look ? { look: { ...edit.look, ...look } } : {}) };
}

/** The parts of a clip's edit worth saving as the brand kit's look. */
export function lookOf(edit: ClipEdit): BrandLook {
  return brandLookSchema.parse({
    framing: edit.framing,
    captions: edit.captions,
    captionStyle: edit.captionStyle,
    captionPosition: edit.captionPosition,
    ...(edit.look ? { look: edit.look } : {}),
    ...(edit.logo ? { logo: edit.logo } : {}),
  });
}

/** True when the kit says nothing yet (nothing saved, no logo). */
export const kitIsEmpty = (kit: BrandKit) => !kit.logo && Object.values(kit.look).every((v) => v === undefined);
