import { userRoute } from "@/lib/server/http";
import { retryImport } from "@/lib/server/jobs";

type Params = { id: string };

/** Try a failed import again, from wherever it can resume. */
export const POST = userRoute<Params>(async (_req, { userId, params }) => Response.json(await retryImport(userId, params.id)), {
  rate: { bucket: "create", limit: 15, windowMs: 10 * 60_000 },
});
