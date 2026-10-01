import { z } from "zod";
import { intervalSchema, planIdSchema } from "@/lib/billing/plans";
import { appOrigin, createPortal } from "@/lib/server/billing";
import { readJson, userRoute } from "@/lib/server/http";

/** `plan` and `interval`: open on switching to that plan. */
const portalSchema = z.object({ plan: planIdSchema.optional(), interval: intervalSchema.optional() });

/** Open Stripe's billing portal (change plan, card, invoices, cancel): answers with its address. */
export const POST = userRoute(
  async (req, { userId }) => {
    const { plan, interval } = await readJson(req, portalSchema);
    const target = plan ? { plan, interval: interval ?? "month" } : undefined;
    return Response.json({ url: await createPortal(userId, appOrigin(req), target) });
  },
  { rate: { bucket: "billing", limit: 20, windowMs: 10 * 60_000 } },
);
