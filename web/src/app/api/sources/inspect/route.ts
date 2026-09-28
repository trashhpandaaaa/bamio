import { inspectRequestSchema } from "@/lib/clips/schema";
import { readJson, userRoute } from "@/lib/server/http";
import { inspectCached } from "@/lib/server/media";

/** Look up a link's title, length and thumbnail before importing it. */
export const POST = userRoute(
  async (req) => {
    const { url } = await readJson(req, inspectRequestSchema);
    return Response.json(await inspectCached(url));
  },
  { rate: { bucket: "inspect", limit: 30, windowMs: 60_000 } },
);
