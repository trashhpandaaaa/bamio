import { listDownloads, removeDownload } from "@/lib/server/downloads";
import { userRoute } from "@/lib/server/http";

type Params = { id: string };

/** Take a download off the list and delete its file. Answers with the list as it is now. */
export const DELETE = userRoute<Params>(async (_req, { userId, params }) => {
  await removeDownload(userId, params.id);
  return Response.json(await listDownloads(userId));
});
