import { currentUser } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { intervalSchema, planIdSchema } from "@/lib/billing/plans";
import { appOrigin, createCheckout } from "@/lib/server/billing";
import { readJson, userRoute } from "@/lib/server/http";
import { REFERRAL_COOKIE } from "@/lib/server/referrals";

const checkoutSchema = z.object({ plan: planIdSchema, interval: intervalSchema });

/** Start buying a plan: answers with the Stripe Checkout page to send the browser to. */
export const POST = userRoute(
  async (req, { userId }) => {
    const input = await readJson(req, checkoutSchema);
    // Fills in the email on Stripe's page.
    const email = (await currentUser().catch(() => null))?.primaryEmailAddress?.emailAddress;
    // A friend's referral link they arrived through (app/r/[code]).
    const referral = (await cookies()).get(REFERRAL_COOKIE)?.value;
    return Response.json({ url: await createCheckout(userId, { ...input, origin: appOrigin(req), email, referral }) });
  },
  { rate: { bucket: "billing", limit: 20, windowMs: 10 * 60_000 } },
);
