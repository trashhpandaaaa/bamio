import { brandLookSchema } from "@/lib/clips/brand";
import { BRAND_LOGO_MAX_BYTES, readBrandKit, removeBrandLogo, saveBrandLogo, saveBrandLook } from "@/lib/server/brand";
import { assertClipFeature } from "@/lib/server/clip-access";
import { HttpError, readJson, userRoute } from "@/lib/server/http";

/*
 * The account's brand kit (Starter): the caption look and logo new clips start with.
 * Reading it is open to everyone, so the page can show what is saved and what it would cost
 * to use; saving needs the plan.
 */

export const GET = userRoute(async (_req, { userId }) => Response.json(await readBrandKit(userId)));

/** Save the look. */
export const PUT = userRoute(async (req, { userId }) => {
  await assertClipFeature(userId, "brandKit");
  const look = await readJson(req, brandLookSchema);
  return Response.json(await saveBrandLook(userId, look));
});

/** Replace the logo (the body is the picture itself: PNG, JPEG or WebP). */
export const POST = userRoute(
  async (req, { userId }) => {
    await assertClipFeature(userId, "brandKit");
    const length = Number(req.headers.get("content-length") ?? 0);
    if (length > BRAND_LOGO_MAX_BYTES) throw new HttpError(413, "too_large", `A logo can be up to ${BRAND_LOGO_MAX_BYTES / 1024 / 1024} MB.`);
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength === 0) throw new HttpError(400, "bad_request", "Choose a picture to upload.");
    return Response.json(await saveBrandLogo(userId, bytes));
  },
  { rate: { bucket: "brand-logo", limit: 20, windowMs: 60 * 60_000 } },
);

export const DELETE = userRoute(async (_req, { userId }) => Response.json(await removeBrandLogo(userId)));
