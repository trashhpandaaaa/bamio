import { myCampaign, withdrawClip } from "@/lib/server/campaigns";
import { HttpError, userRoute } from "@/lib/server/http";

/** Take back a clip that's still waiting for a look. */
export const DELETE = userRoute<{ slug: string; clipId: string }>(
  async (_req, { userId, params }) => {
    if (!/^\d{1,12}$/.test(params.clipId)) throw new HttpError(404, "not_found", "That clip isn’t in this campaign.");
    await withdrawClip(userId, Number(params.clipId));
    return Response.json(await myCampaign(userId, params.slug));
  },
  { rate: { bucket: "campaign-clip", limit: 30, windowMs: 10 * 60_000 } },
);
