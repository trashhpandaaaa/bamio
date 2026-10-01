import { findClipsSchema } from "@/lib/clips/schema";
import { assertPlan } from "@/lib/server/billing";
import { readJson, userRoute } from "@/lib/server/http";
import { startAnalysis } from "@/lib/server/jobs";

type Params = { id: string };

/** Ask the AI for (more) clips. Transcribes first if the project has no transcript yet. */
export const POST = userRoute<Params>(
  async (req, { userId, params }) => {
    const { clipLength } = await readJson(req, findClipsSchema);
    await assertPlan(userId);
    return Response.json(await startAnalysis(userId, params.id, clipLength));
  },
  { rate: { bucket: "find", limit: 10, windowMs: 10 * 60_000 } },
);
