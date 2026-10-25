import { gate, LEVELS, TOP_LEVEL, type Level } from "@/lib/billing/levels";
import type { PlanId } from "@/lib/billing/plans";

/*
 * What the editor gives to whom. The basics are free for every account: cutting, combining,
 * text in any typeface and colour, picture layers (a logo), transitions, freeze frames, reverse,
 * music, a voiceover, every shape, a 720p export with no watermark. The features below
 * need a plan, each from the plan named here up: the good ones from Starter, the high-end ones
 * from Pro. Moving a feature between plans, or making it free, is its line in this table (and
 * its line on the pricing page: billing/plans.ts lists every one under its plan by the name
 * here, and a test keeps the two in step).
 *
 * The editor runs in the browser, so these are locks on its own controls, not on a server:
 * someone set on it could open them in their own browser. They are there to be fair to the
 * people who pay, not to be unbreakable. A feature that needs the server can check the plan
 * there (billing.ts); the clip side does, and its own table is lib/clips/features.ts.
 */

/** The ladder every paid feature stands on (billing/levels.ts), under the editor's old names. */
export const EDITOR_LEVELS = LEVELS;
export type EditorLevel = Level;
export { TOP_LEVEL };

export const EDITOR_FEATURES = {
  hd: { needs: "starter", name: "1080p export" },
  captions: { needs: "starter", name: "Editable captions from your clips" },
  layouts: { needs: "starter", name: "Picture-in-picture and layouts" },
  level: { needs: "starter", name: "Loudness levelling" },
  shapes: { needs: "starter", name: "Several shapes in one export" },
  silence: { needs: "pro", name: "Silence removal" },
  smooth: { needs: "pro", name: "60 fps export" },
  duck: { needs: "pro", name: "Music that ducks under speech" },
  autoCaptions: { needs: "pro", name: "Auto captions in the editor" },
  reframe: { needs: "pro", name: "Auto-reframe" },
  beats: { needs: "pro", name: "Cut to the beat" },
  greenScreen: { needs: "pro", name: "Green screen" },
  bigExport: { needs: "pro", name: "4K and longer exports" },
} as const satisfies Record<string, { needs: PlanId; name: string }>;
export type EditorFeature = keyof typeof EDITOR_FEATURES;

const editor = gate(EDITOR_FEATURES);

/** Whether an account at `level` has `feature`. */
export const can = (level: EditorLevel, feature: EditorFeature): boolean => editor.can(level, feature);

/** The plan a feature starts at, by its name: "Starter", "Pro". */
export const planFor = (feature: EditorFeature): string => editor.planFor(feature);
