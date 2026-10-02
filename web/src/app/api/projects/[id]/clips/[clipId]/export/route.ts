import { attachmentName, HttpError, userRoute } from "@/lib/server/http";
import { startExport } from "@/lib/server/jobs";
import { storage } from "@/lib/server/storage";
import { getProject, mediaKeys } from "@/lib/server/store";

type Params = { id: string; clipId: string };

/** Render the clip to a 1080p MP4. Progress shows up on the clip's export state. */
export const POST = userRoute<Params>(
  async (_req, { userId, params }) => Response.json(await startExport(userId, params.id, params.clipId), { status: 202 }),
  { rate: { bucket: "export", limit: 30, windowMs: 10 * 60_000 } },
);

/** Download the finished export (?view=1 plays it in the browser instead): streamed, or a signed link to it. */
export const GET = userRoute<Params>(async (req, { userId, params }) => {
  const project = await getProject(userId, params.id);
  const clip = project.clips.find((c) => c.id === params.clipId);
  if (!clip) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
  if (clip.export?.status !== "done") throw new HttpError(404, "not_exported", "Export this clip first.");
  const view = new URL(req.url).searchParams.get("view") === "1";
  return storage().serve(req, mediaKeys(userId, project.id).export(clip.id), {
    type: "video/mp4",
    downloadName: view ? undefined : attachmentName(clip.title, "mp4"),
  });
});
