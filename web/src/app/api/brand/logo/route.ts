import { readBrandKit } from "@/lib/server/brand";
import { HttpError, userRoute } from "@/lib/server/http";
import { imageType } from "@/lib/server/image-kind";
import { storage } from "@/lib/server/storage";
import { brandKeys } from "@/lib/server/store";

/** The account's own brand logo, for the clip editor's preview. Nobody else's is reachable. */
export const GET = userRoute(async (req, { userId }) => {
  const kit = await readBrandKit(userId);
  if (!kit.logo) throw new HttpError(404, "no_logo", "You haven’t saved a logo.");
  return storage().serve(req, brandKeys(userId).logo(kit.logo.ext), { type: imageType(kit.logo.ext), maxAge: 300 });
});
