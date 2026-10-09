import { PLANS, type PlanId } from "@/lib/billing/plans";

/*
 * What the editor gives to whom. The basics are free for every account: cutting, combining,
 * text, music, a voiceover, every shape, a 720p export with no watermark. The features below
 * need a plan, each from the plan named here up: the good ones from Starter, the high-end ones
 * from Pro. Moving a feature between plans, or making it free, is its line in this table (and
 * its line on the pricing page: billing/plans.ts lists every one under its plan by the name
 * here, and a test keeps the two in step).
 *
 * The editor runs in the browser, so these are locks on its own controls, not on a server:
 * someone set on it could open them in their own browser. They are there to be fair to the
 * people who pay, not to be unbreakable. A feature that needs the server can check the plan
 * there (billing.ts).
 */

/** No plan, then the plans from the smallest up. With plans off (no Stripe key) everyone is at the top. */
export const EDITOR_LEVELS = ["free", "starter", "pro", "team"] as const;
export type EditorLevel = (typeof EDITOR_LEVELS)[number];
export const TOP_LEVEL: EditorLevel = "team";

export const EDITOR_FEATURES = {
  hd: { needs: "starter", name: "1080p export" },
  silence: { needs: "pro", name: "Silence removal" },
  smooth: { needs: "pro", name: "60 fps export" },
  duck: { needs: "pro", name: "Music that ducks under speech" },
} as const satisfies Record<string, { needs: PlanId; name: string }>;
export type EditorFeature = keyof typeof EDITOR_FEATURES;

/** Whether an account at `level` has `feature`. */
export const can = (level: EditorLevel, feature: EditorFeature): boolean => EDITOR_LEVELS.indexOf(level) >= EDITOR_LEVELS.indexOf(EDITOR_FEATURES[feature].needs);

/** The plan a feature starts at, by its name: "Starter", "Pro". */
export const planFor = (feature: EditorFeature): string => PLANS[EDITOR_FEATURES[feature].needs].name;
