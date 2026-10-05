import { z } from "zod";
import { defaultAccountDeps, requestAccountDeletion } from "@/lib/server/accounts";
import { readJson, userRoute } from "@/lib/server/http";

const body = z.object({ confirm: z.literal("delete") });

/**
 * Delete the signed-in user's account: queued for the workers (Stripe, media, every row), then
 * the Clerk user goes at once, which ends the session. If Clerk can't be reached now, the
 * workers delete it after the rest.
 */
export const DELETE = userRoute(
  async (req, { userId }) => {
    await readJson(req, body);
    await requestAccountDeletion(userId, "self");
    await defaultAccountDeps.deleteClerkUser(userId).catch(() => undefined);
    return new Response(null, { status: 204 });
  },
  { rate: { bucket: "account", limit: 5, windowMs: 10 * 60_000 } },
);
