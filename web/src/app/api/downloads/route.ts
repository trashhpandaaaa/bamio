import { downloadRequestSchema } from "@/lib/downloads/schema";
import { listDownloads, startDownload } from "@/lib/server/downloads";
import { readJson, userRoute } from "@/lib/server/http";

/** The account's downloads, newest first, and how many more it may start today. */
export const GET = userRoute(async (_req, { userId }) => Response.json(await listDownloads(userId)));

/** Take a link to a video for downloading: checked here, fetched by the workers' downloader. */
export const POST = userRoute(
  async (req, { userId }) => {
    const { url } = await readJson(req, downloadRequestSchema);
    return Response.json(await startDownload(userId, url), { status: 202 });
  },
  { rate: { bucket: "download", limit: 30, windowMs: 10 * 60_000 } },
);
