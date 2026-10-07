import { z } from "zod";
import { campaignInputSchema } from "@/lib/campaigns/schema";
import { adminRoute } from "@/lib/server/admin";
import { createCampaignFromRequest } from "@/lib/server/campaign-requests";
import { createCampaign } from "@/lib/server/campaigns";
import { readJson } from "@/lib/server/http";

/** `requestId`: the request to run a campaign (the form on /clippers) this one answers. */
const body = z.object({ campaign: campaignInputSchema, requestId: z.number().int().positive().optional() });

/** Make a campaign, as a draft (admins): from scratch, or from someone's request to run one. */
export const POST = adminRoute(async (req, { admin }) => {
  const { campaign, requestId } = await readJson(req, body);
  const made = requestId ? await createCampaignFromRequest(admin, requestId, campaign) : await createCampaign(admin, campaign);
  return Response.json(made, { status: 201 });
});
