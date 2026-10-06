import { z } from "zod";
import { campaignInputSchema } from "@/lib/campaigns/schema";
import { adminRoute } from "@/lib/server/admin";
import { deleteCampaign, setCampaignStatus, updateCampaign } from "@/lib/server/campaigns";
import { readJson } from "@/lib/server/http";

type Params = { id: string };
const body = z.union([z.object({ status: z.enum(["live", "paused", "ended"]) }), z.object({ campaign: campaignInputSchema })]);

/** Change a campaign's words and terms, or open, pause or end it (admins). */
export const PATCH = adminRoute<Params>(async (req, { admin, params }) => {
  const change = await readJson(req, body);
  if ("status" in change) await setCampaignStatus(admin, params.id, change.status);
  else await updateCampaign(admin, params.id, change.campaign);
  return Response.json({ ok: true });
});

/** Delete a draft (admins). */
export const DELETE = adminRoute<Params>(async (_req, { admin, params }) => {
  await deleteCampaign(admin, params.id);
  return Response.json({ ok: true });
});
