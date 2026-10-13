import { z } from "zod";
import { LINK_MAX } from "@/lib/campaigns/links";
import { myCampaign, submitClip } from "@/lib/server/campaigns";
import { readJson, userRoute } from "@/lib/server/http";
import { sessionCountry } from "@/lib/server/session-country";

/** Send a clip the user posted (its link). It waits for an admin before it counts. */
export const POST = userRoute<{ slug: string }>(
  async (req, { userId, params }) => {
    const { url } = await readJson(req, z.object({ url: z.string().min(1).max(LINK_MAX) }));
    await submitClip(userId, params.slug, url, undefined, Date.now(), await sessionCountry());
    return Response.json(await myCampaign(userId, params.slug), { status: 201 });
  },
  { rate: { bucket: "campaign-clip", limit: 30, windowMs: 10 * 60_000 } },
);
