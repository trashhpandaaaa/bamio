import { clipEditSchema, updateProjectSchema } from "@/lib/clips/schema";
import { HttpError, readJson, userRoute } from "@/lib/server/http";
import { stopProject } from "@/lib/server/jobs";
import { deleteProjectFiles, getProject, mutateProject } from "@/lib/server/store";

type Params = { id: string };

export const GET = userRoute<Params>(async (_req, { userId, params }) => Response.json(await getProject(userId, params.id)));

/** Rename, or copy one clip's look (frame and caption style) to every clip. */
export const PATCH = userRoute<Params>(async (req, { userId, params }) => {
  const input = await readJson(req, updateProjectSchema);
  const project = await mutateProject(userId, params.id, (p) => {
    let next = input.title ? { ...p, title: input.title } : p;
    if (input.applyEditFrom) {
      const from = p.clips.find((c) => c.id === input.applyEditFrom);
      if (!from) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
      const { aspect, framing, captions, captionStyle, captionPosition, showTitle } = from.edit;
      const look = { aspect, framing, captions, captionStyle, captionPosition, showTitle };
      next = {
        ...next,
        defaultEdit: clipEditSchema.parse({ ...next.defaultEdit, ...look }),
        clips: next.clips.map((c) => ({ ...c, edit: { ...c.edit, ...look } })),
      };
    }
    return next;
  });
  return Response.json(project);
});

export const DELETE = userRoute<Params>(async (_req, { userId, params }) => {
  await getProject(userId, params.id);
  await stopProject(params.id);
  await deleteProjectFiles(userId, params.id);
  return new Response(null, { status: 204 });
});
