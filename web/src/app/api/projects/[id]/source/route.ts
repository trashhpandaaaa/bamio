import { userRoute } from "@/lib/server/http";
import { storage } from "@/lib/server/storage";
import { getProject, mediaKeys } from "@/lib/server/store";

type Params = { id: string };

/** The prepared source video: streamed with Range support (local storage), or a redirect to a short-lived signed link (S3). */
export const GET = userRoute<Params>(async (req, { userId, params }) => {
  const project = await getProject(userId, params.id);
  return storage().serve(req, mediaKeys(userId, project.id).source, { type: "video/mp4", maxAge: 3600 });
});
