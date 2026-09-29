import { HttpError, userRoute } from "@/lib/server/http";
import { getProject, running } from "@/lib/server/store";

type Params = { id: string };

/** End a live recording now; what was captured so far goes on to be processed. */
export const POST = userRoute<Params>(async (_req, { userId, params }) => {
  const project = await getProject(userId, params.id);
  const stop = running.stops.get(project.id);
  if (!stop) throw new HttpError(409, "not_recording", "This project isn\u2019t recording.");
  stop.abort();
  return Response.json(project);
});
