import { clerkClient } from "@clerk/nextjs/server";
import { clipperInputSchema } from "@/lib/campaigns/schema";
import { assertCampaignAccess } from "@/lib/server/campaign-access";
import { joinCampaign, myCampaign } from "@/lib/server/campaigns";
import { readJson, userRoute } from "@/lib/server/http";

/** Join a campaign, saving the clipper's name, channel and payout details with it. */
export const POST = userRoute<{ slug: string }>(
  async (req, { userId, params }) => {
    await assertCampaignAccess(userId);
    const input = await readJson(req, clipperInputSchema);
    const user = await (await clerkClient()).users.getUser(userId);
    await joinCampaign(userId, params.slug, input, user.hasImage ? user.imageUrl : null);
    return Response.json(await myCampaign(userId, params.slug));
  },
  { rate: { bucket: "campaign-join", limit: 20, windowMs: 10 * 60_000 } },
);
