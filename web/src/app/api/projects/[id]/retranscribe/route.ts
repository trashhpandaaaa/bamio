import { userRoute } from "@/lib/server/http";
import { startRetranscribe } from "@/lib/server/jobs";

type Params = { id: string };

/** Transcribe the video again on this device (English), for word-accurate caption timing. */
export const POST = userRoute<Params>(async (_req, { userId, params }) => Response.json(await startRetranscribe(userId, params.id)), {
  rate: { bucket: "find", limit: 10, windowMs: 10 * 60_000 },
});
