import { retranscribeSchema } from "@/lib/clips/schema";
import { assertPlan } from "@/lib/server/billing";
import { readJson, userRoute } from "@/lib/server/http";
import { startRetranscribe } from "@/lib/server/jobs";

type Params = { id: string };

/**
 * Transcribe the video again on this device: for word-accurate caption timing, a better
 * transcriber, or another spoken language ({ language }, when detection got it wrong). The
 * body is optional.
 */
export const POST = userRoute<Params>(
  async (req, { userId, params }) => {
    const { language } = req.headers.get("content-type")?.includes("json") ? await readJson(req, retranscribeSchema) : {};
    await assertPlan(userId);
    return Response.json(await startRetranscribe(userId, params.id, language));
  },
  { rate: { bucket: "find", limit: 10, windowMs: 10 * 60_000 } },
);
