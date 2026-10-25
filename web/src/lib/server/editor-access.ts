import "server-only";
import type { EditorLevel } from "@/lib/editor/features";
import { planLevel } from "@/lib/server/plan-level";

/*
 * Which of the editor's features an account has (lib/editor/features.ts). The rung it stands
 * on is worked out once, for the editor and the clip side alike: lib/server/plan-level.ts.
 */
export async function editorLevel(userId: string): Promise<EditorLevel> {
  return planLevel(userId);
}
