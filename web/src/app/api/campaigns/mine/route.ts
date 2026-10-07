import { assertCampaignAccess } from "@/lib/server/campaign-access";
import { myCampaigns } from "@/lib/server/campaigns";
import { userRoute } from "@/lib/server/http";

/** The campaigns the signed-in user joined, with what each has earned them. Campaigns are for accounts with a plan. */
export const GET = userRoute(async (_req, { userId }) => {
  await assertCampaignAccess(userId);
  return Response.json(await myCampaigns(userId));
});
