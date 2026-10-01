import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { intervalSchema, planIdSchema } from "@/lib/billing/plans";
import { appOrigin, createCheckout } from "@/lib/server/billing";
import { readJson, userRoute } from "@/lib/server/http";

const checkoutSchema = z.object({ plan: planIdSchema, interval: intervalSchema });

/** Start buying a plan: answers with the Stripe Checkout page to send the browser to. */
export const POST = userRoute(
  async (req, { userId }) => {
    const input = await readJson(req, checkoutSchema);
    // Fills in the email on Stripe's page.
    const email = (await currentUser().catch(() => null))?.primaryEmailAddress?.emailAddress;
    return Response.json({ url: await createCheckout(userId, { ...input, origin: appOrigin(req), email }) });
  },
  { rate: { bucket: "billing", limit: 20, windowMs: 10 * 60_000 } },
);
