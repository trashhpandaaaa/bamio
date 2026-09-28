import { clipRangeError, formatTimecode } from "@/lib/clips/logic";
import { addClipSchema, LIMITS, type Clip } from "@/lib/clips/schema";
import { HttpError, readJson, userRoute } from "@/lib/server/http";
import { isPrepared, mutateProject } from "@/lib/server/store";
import { newId } from "@/lib/ids";

type Params = { id: string };

/** Add a clip the user marked by hand. */
export const POST = userRoute<Params>(async (req, { userId, params }) => {
  const input = await readJson(req, addClipSchema);
  const id = newId();
  const project = await mutateProject(userId, params.id, (p) => {
    if (!isPrepared(p)) throw new HttpError(409, "not_ready", "Wait for the video to finish processing.");
    if (p.clips.length >= LIMITS.maxClips) throw new HttpError(409, "too_many", `A project can have up to ${LIMITS.maxClips} clips. Delete one first.`);
    const clip: Clip = {
      id,
      title: input.title || `Clip at ${formatTimecode(input.start)}`,
      start: Math.round(input.start * 100) / 100,
      end: Math.round(input.end * 100) / 100,
      origin: "manual",
      edit: { ...p.defaultEdit },
      createdAt: Date.now(),
    };
    const problem = clipRangeError(clip.start, clip.end, p.source.durationSec);
    if (problem) throw new HttpError(400, "bad_range", problem);
    return { ...p, clips: [...p.clips, clip] };
  });
  return Response.json({ project, clipId: id }, { status: 201 });
});
