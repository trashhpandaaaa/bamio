import { campaignInputSchema } from "@/lib/campaigns/schema";
import { adminRoute } from "@/lib/server/admin";
import { createCampaign } from "@/lib/server/campaigns";
import { readJson } from "@/lib/server/http";

/** Make a campaign, as a draft (admins). */
export const POST = adminRoute(async (req, { admin }) => Response.json(await createCampaign(admin, await readJson(req, campaignInputSchema)), { status: 201 }));
