import { currentUser } from "@clerk/nextjs/server";
import { campaignRequestSchema } from "@/lib/campaigns/schema";
import { myCampaignRequests, requestCampaign } from "@/lib/server/campaign-requests";
import { readJson, userRoute } from "@/lib/server/http";

/** The signed-in user's requests to run a campaign, and where each stands. */
export const GET = userRoute(async (_req, { userId }) => Response.json(await myCampaignRequests(userId)));

/** Ask to run a campaign (the form on /clippers). It waits for Bamio's team; answers with the user's requests as they are now. */
export const POST = userRoute(
  async (req, { userId }) => {
    const input = await readJson(req, campaignRequestSchema);
    // Where the team answers: the account's own address, read here, never taken from the form.
    const email = (await currentUser().catch(() => null))?.primaryEmailAddress?.emailAddress ?? null;
    await requestCampaign(userId, input, email);
    return Response.json(await myCampaignRequests(userId), { status: 201 });
  },
  { rate: { bucket: "campaign-request", limit: 20, windowMs: 60 * 60_000 } },
);
