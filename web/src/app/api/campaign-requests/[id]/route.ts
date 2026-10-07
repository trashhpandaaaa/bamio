import { myCampaignRequests, withdrawCampaignRequest } from "@/lib/server/campaign-requests";
import { HttpError, userRoute } from "@/lib/server/http";

/** Take back a request to run a campaign that nobody has answered yet. */
export const DELETE = userRoute<{ id: string }>(
  async (_req, { userId, params }) => {
    if (!/^\d{1,12}$/.test(params.id)) throw new HttpError(404, "not_found", "That request isn’t there any more.");
    await withdrawCampaignRequest(userId, Number(params.id));
    return Response.json(await myCampaignRequests(userId));
  },
  { rate: { bucket: "campaign-request", limit: 20, windowMs: 60 * 60_000 } },
);
