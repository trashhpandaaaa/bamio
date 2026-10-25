import "server-only";
import { TOP_LEVEL, type Level } from "@/lib/billing/levels";
import { adminOf } from "@/lib/server/admin";
import { billingEnabled, billingState } from "@/lib/server/billing";

/*
 * Which rung of the plan ladder an account stands on (billing/levels.ts), for the two tables
 * of paid features: the editor's (lib/editor/features.ts) and the clip side's
 * (lib/clips/features.ts).
 *
 * The plan that works for it now, paid or given without paying. The free trial isn't a plan,
 * and neither is a plan that has ended. Admins have everything, since they answer for all of
 * it. With plans off (no Stripe key) nothing is limited, as everywhere else. A team member
 * stands where their team's owner does: billingState resolves that (lib/server/teams.ts).
 */
export async function planLevel(userId: string): Promise<Level> {
  if (!billingEnabled()) return TOP_LEVEL;
  const state = await billingState(userId);
  if (state.active && state.plan) return state.plan;
  return (await adminOf(userId)) ? TOP_LEVEL : "free";
}
