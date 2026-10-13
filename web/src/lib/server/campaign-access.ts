import "server-only";
import { adminOf } from "@/lib/server/admin";
import { db } from "@/lib/server/db";

/*
 * Campaigns are open to everyone: anyone can see them, and any account can join and send clips,
 * with or without a plan (the user's decision, 2026-10-13; from 2026-10-07 they were for
 * subscribers only). One thing still depends on who is looking: the person who asked for a
 * campaign (campaign-requests.ts) sees "Your campaign" on it instead of the way to join.
 */

/** Whether this campaign was made from this user's request (an admin running it isn't its owner). */
export async function ownsCampaign(userId: string | null, campaignId: string): Promise<boolean> {
  if (!userId || (await adminOf(userId))) return false;
  const mine = await db()`select 1 from campaign_requests where campaign_id = ${campaignId} and user_id = ${userId} and status = 'accepted' limit 1`;
  return mine.length > 0;
}
