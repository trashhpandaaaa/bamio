import { captionJob } from "@/lib/server/editor-captions";
import { userRoute } from "@/lib/server/http";

type Params = { id: string };

/** How a caption job is going, and its words once they're ready. */
export const GET = userRoute<Params>(async (_req, { userId, params }) => Response.json(await captionJob(userId, params.id)));
