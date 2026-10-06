import { myCampaigns } from "@/lib/server/campaigns";
import { userRoute } from "@/lib/server/http";

/** The campaigns the signed-in user joined, with what each has earned them. */
export const GET = userRoute(async (_req, { userId }) => Response.json(await myCampaigns(userId)));
