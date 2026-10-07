import { assertCampaignAccess } from "@/lib/server/campaign-access";
import { myCampaign } from "@/lib/server/campaigns";
import { userRoute } from "@/lib/server/http";

/** The signed-in user's place in a campaign: whether they joined, their clips, what they've earned and been paid. */
export const GET = userRoute<{ slug: string }>(async (_req, { userId, params }) => {
  await assertCampaignAccess(userId);
  return Response.json(await myCampaign(userId, params.slug));
});
