import { PLANS, type PlanId } from "@/lib/billing/plans";

/*
 * What an account may use, as one ladder: no plan, then the plans from the smallest up.
 * Two tables of paid features stand on it, each naming the plan a feature starts at:
 * lib/editor/features.ts (the browser editor) and lib/clips/features.ts (clips and exports).
 *
 * A feature's line here and its line on the pricing page (billing/plans.ts) must agree, by
 * the same name under the same plan, and a test keeps them in step: nobody should pay for
 * something that isn't there, and nothing built should go unlisted.
 */

export const LEVELS = ["free", "starter", "pro", "team"] as const;
export type Level = (typeof LEVELS)[number];

/** With plans off (no Stripe key) nothing is limited, so everyone is here. */
export const TOP_LEVEL: Level = "team";

export type FeatureTable = Record<string, { needs: PlanId; name: string }>;

/** Whether an account at `level` has reached `needs`. */
export const atLeast = (level: Level, needs: PlanId): boolean => LEVELS.indexOf(level) >= LEVELS.indexOf(needs);

/** `can` and `planFor` for one table of features (see the two tables above). */
export function gate<T extends FeatureTable>(table: T) {
  return {
    can: (level: Level, feature: keyof T): boolean => atLeast(level, table[feature]!.needs),
    /** The plan a feature starts at, by its name: "Starter", "Pro". */
    planFor: (feature: keyof T): string => PLANS[table[feature]!.needs].name,
  };
}
