import { isFollowing } from "@/lib/clips/schema";
import { HttpError, userRoute } from "@/lib/server/http";
import { stopRecording } from "@/lib/server/jobs";
import { getProject } from "@/lib/server/store";

type Params = { id: string };

/** End a live recording now; what was captured so far goes on to be processed (by whichever worker is recording it). */
export const POST = userRoute<Params>(async (_req, { userId, params }) => {
  const project = await getProject(userId, params.id);
  const recording = project.job.status === "recording" || isFollowing(project);
  if (!recording || !(await stopRecording(project.id))) throw new HttpError(409, "not_recording", "This project isn’t recording.");
  return Response.json(project);
});
