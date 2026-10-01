import { billingState } from "@/lib/server/billing";
import { userRoute } from "@/lib/server/http";

/**
 * The signed-in user's plan, renewal, AI minutes used this month and projects kept.
 * ?fresh=1 reads the plan from Stripe first (back from Checkout or the billing portal).
 */
export const GET = userRoute(async (req, { userId }) => Response.json(await billingState(userId, { fresh: new URL(req.url).searchParams.has("fresh") })), {
  rate: { bucket: "billing-read", limit: 120, windowMs: 10 * 60_000 },
});
