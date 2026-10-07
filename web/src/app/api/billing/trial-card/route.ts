import { currentUser } from "@clerk/nextjs/server";
import { z } from "zod";
import { appOrigin, startTrialCard } from "@/lib/server/billing";
import { readJson, userRoute } from "@/lib/server/http";

const body = z.object({
  /** The page to come back to. */
  from: z.enum(["new", "billing"]),
  /** On the import page: the link already pasted, kept across the trip to Stripe. */
  link: z.string().max(2000).optional(),
});

/**
 * Start the card check for the free first video: answers with the Stripe page to send the
 * browser to. The card is checked and saved, never charged.
 */
export const POST = userRoute(
  async (req, { userId }) => {
    const { from, link } = await readJson(req, body);
    // Fills in the email on Stripe's page.
    const email = (await currentUser().catch(() => null))?.primaryEmailAddress?.emailAddress;
    // Stripe returns to a page of this site, built here (never an address from the request).
    const back = from === "billing" ? "/billing" : link ? `/new?url=${encodeURIComponent(link)}` : "/new";
    return Response.json({ url: await startTrialCard(userId, { origin: appOrigin(req), back, email }) });
  },
  { rate: { bucket: "billing", limit: 20, windowMs: 10 * 60_000 } },
);
