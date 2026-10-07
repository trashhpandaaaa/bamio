import "server-only";
import { adminOf } from "@/lib/server/admin";
import { billingEnabled, hasPlan } from "@/lib/server/billing";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";

/*
 * Who may see campaigns. They are for subscribers: an account with a working plan, paid or
 * given without paying. The free trial isn't a plan. Everyone else (signed out, no plan, a
 * plan that has ended) sees that campaigns exist and how to get in, never a campaign: not its
 * name, its terms, its leaderboard or its clippers. Two exceptions: admins, who run the
 * campaigns, and the person who asked for a campaign (campaign-requests.ts), who may open that
 * one. With plans off (no Stripe key) nothing is limited, as everywhere else.
 */

/** "owner": no plan, but this campaign was made from their request. */
export type CampaignAccess = "open" | "owner" | "signed_out" | "no_plan";

/** May this visitor see campaigns? With `campaignId`, also whether that one is theirs. */
export async function campaignAccess(userId: string | null, campaignId?: string): Promise<CampaignAccess> {
  if (!billingEnabled()) return "open";
  if (!userId) return "signed_out";
  if (await hasPlan(userId)) return "open";
  if (await adminOf(userId)) return "open";
  if (campaignId) {
    const mine = await db()`select 1 from campaign_requests where campaign_id = ${campaignId} and user_id = ${userId} and status = 'accepted' limit 1`;
    if (mine.length > 0) return "owner";
  }
  return "no_plan";
}

export const canSeeCampaigns = (access: CampaignAccess) => access === "open" || access === "owner";

/** For the clipper's API routes (their campaigns, joining, sending clips): a plan, or nothing. */
export async function assertCampaignAccess(userId: string): Promise<void> {
  if ((await campaignAccess(userId)) !== "open") throw new HttpError(402, "plan_required", "Campaigns are for accounts with a plan. Choose a plan to take part.");
}
