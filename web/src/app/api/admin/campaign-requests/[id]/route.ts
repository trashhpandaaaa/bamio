import { z } from "zod";
import { CAMPAIGN_LIMITS } from "@/lib/campaigns/schema";
import { adminRoute } from "@/lib/server/admin";
import { declineCampaignRequest } from "@/lib/server/campaign-requests";
import { HttpError, readJson } from "@/lib/server/http";

const body = z.object({
  action: z.literal("decline"),
  note: z
    .string()
    .max(CAMPAIGN_LIMITS.note)
    .transform((s) => s.replace(/\s+/g, " ").trim()),
});

/** Decline a request to run a campaign, with a word why (admins). Accepting one is making its campaign: POST /api/admin/campaigns with its id. */
export const POST = adminRoute<{ id: string }>(async (req, { admin, params }) => {
  if (!/^\d{1,12}$/.test(params.id)) throw new HttpError(404, "not_found", "That request isn’t there any more.");
  const { note } = await readJson(req, body);
  await declineCampaignRequest(admin, Number(params.id), note);
  return Response.json({ ok: true });
});
