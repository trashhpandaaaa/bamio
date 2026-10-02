import { clipRangeError } from "@/lib/clips/logic";
import { clipEditSchema, updateClipSchema } from "@/lib/clips/schema";
import { HttpError, readJson, userRoute } from "@/lib/server/http";
import { stopExport } from "@/lib/server/jobs";
import { storage } from "@/lib/server/storage";
import { getProject, mediaKeys, mutateProject } from "@/lib/server/store";

type Params = { id: string; clipId: string };

/** Rename, retime or restyle a clip. */
export const PATCH = userRoute<Params>(async (req, { userId, params }) => {
  const input = await readJson(req, updateClipSchema);
  const project = await mutateProject(userId, params.id, (p) => {
    const clip = p.clips.find((c) => c.id === params.clipId);
    if (!clip) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
    const start = input.start === undefined ? clip.start : Math.round(input.start * 100) / 100;
    const end = input.end === undefined ? clip.end : Math.round(input.end * 100) / 100;
    if (input.start !== undefined || input.end !== undefined) {
      const problem = clipRangeError(start, end, p.source.durationSec);
      if (problem) throw new HttpError(400, "bad_range", problem);
    }
    const edit = input.edit ? clipEditSchema.parse({ ...clip.edit, ...input.edit }) : clip.edit;
    const updated = { ...clip, title: input.title ?? clip.title, start, end, edit };
    return { ...p, clips: p.clips.map((c) => (c.id === clip.id ? updated : c)) };
  });
  return Response.json(project);
});

export const DELETE = userRoute<Params>(async (_req, { userId, params }) => {
  const current = await getProject(userId, params.id);
  if (!current.clips.some((c) => c.id === params.clipId)) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
  await stopExport(current.id, params.clipId);
  const project = await mutateProject(userId, params.id, (p) => ({ ...p, clips: p.clips.filter((c) => c.id !== params.clipId) }));
  await storage().remove(mediaKeys(userId, project.id).export(params.clipId));
  return Response.json(project);
});
