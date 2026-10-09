import "server-only";
import { TOP_LEVEL, type EditorLevel } from "@/lib/editor/features";
import { adminOf } from "@/lib/server/admin";
import { billingEnabled, billingState } from "@/lib/server/billing";

/*
 * Which of the editor's features an account has (lib/editor/features.ts): the plan that works
 * for it now, paid or given without paying. The free trial isn't a plan, and neither is a plan
 * that has ended. Admins have everything, since they answer for all of it. With plans off (no
 * Stripe key) nothing is limited, as everywhere else.
 */
export async function editorLevel(userId: string): Promise<EditorLevel> {
  if (!billingEnabled()) return TOP_LEVEL;
  const state = await billingState(userId);
  if (state.active && state.plan) return state.plan;
  return (await adminOf(userId)) ? TOP_LEVEL : "free";
}
