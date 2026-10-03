import { appOrigin, referralState } from "@/lib/server/billing";
import { userRoute } from "@/lib/server/http";

/** The signed-in user's referral link, and what it has earned. */
export const GET = userRoute(async (req, { userId }) => Response.json(await referralState(userId, appOrigin(req))), {
  rate: { bucket: "billing-read", limit: 120, windowMs: 10 * 60_000 },
});
