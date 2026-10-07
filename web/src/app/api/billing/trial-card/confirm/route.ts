import { z } from "zod";
import { billingState, confirmTrialCard } from "@/lib/server/billing";
import { readJson, userRoute } from "@/lib/server/http";

/**
 * Back from Stripe's card check: tie the card to the user's free trial (once per card), and
 * answer with their plan as it is now. 409 when the card can't be used, with the reason.
 */
export const POST = userRoute(
  async (req, { userId }) => {
    const { sessionId } = await readJson(req, z.object({ sessionId: z.string().min(4).max(300) }));
    await confirmTrialCard(userId, sessionId);
    return Response.json(await billingState(userId));
  },
  { rate: { bucket: "billing", limit: 20, windowMs: 10 * 60_000 } },
);
