import { adRewardSchema } from "@/lib/ads";
import { adCreditState, claimReward, startAdView } from "@/lib/server/ad-credits";
import { readJson, userRoute } from "@/lib/server/http";

/** The account's earned AI minutes: the balance, what it has earned today, and the cap. */
export const GET = userRoute(async (_req, { userId }) => Response.json(await adCreditState(userId)));

/**
 * Offer an ad view ("start"), or claim one that has been showing long enough ("claim", with the
 * view's id). A browser can't prove it showed an ad, so what really limits this is the daily
 * cap in src/lib/ads.ts, not the two steps: see src/lib/server/ad-credits.ts.
 */
export const POST = userRoute(
  async (req, { userId }) => {
    const input = await readJson(req, adRewardSchema);
    if (input.action === "start") return Response.json(await startAdView(userId));
    return Response.json(await claimReward(userId, input.id));
  },
  { rate: { bucket: "ads-reward", limit: 60, windowMs: 60 * 60_000 } },
);
