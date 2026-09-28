import { serveFile } from "@/lib/server/files";
import { userRoute } from "@/lib/server/http";
import { getProject, paths } from "@/lib/server/store";

type Params = { id: string };

/** The prepared source video, streamed with Range support so the player can seek. */
export const GET = userRoute<Params>(async (req, { userId, params }) => {
  const project = await getProject(userId, params.id);
  return serveFile(req, paths(userId, project.id).source, { type: "video/mp4", maxAge: 3600 });
});
