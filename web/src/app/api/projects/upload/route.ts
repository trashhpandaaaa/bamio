import { createUploadSchema, LIMITS, UPLOAD_CHUNK_BYTES } from "@/lib/clips/schema";
import { assertCanProcess, projectLimit } from "@/lib/server/billing";
import { readJson, userRoute } from "@/lib/server/http";
import { assertDiskSpace, plannedStages } from "@/lib/server/jobs";
import { blankProject, createProject } from "@/lib/server/store";

/**
 * Start a file upload. The browser then sends the file in chunks to
 * /api/projects/[id]/upload; processing starts when the last chunk arrives. (Its length,
 * and so the AI minutes it needs, is checked once it has arrived.)
 */
export const POST = userRoute(
  async (req, { userId }) => {
    const input = await readJson(req, createUploadSchema);
    await assertCanProcess(userId);
    // The original and the prepared copy can both be on disk for a moment.
    await assertDiskSpace(input.size * 2.2);
    const title = input.fileName.replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/_+/g, " ").trim().slice(0, LIMITS.title) || "Uploaded video";
    const draft = blankProject({
      title,
      source: { kind: "upload", platform: "upload", title, durationSec: 0 },
      findClips: input.findClips,
      clipLength: input.clipLength,
      language: input.language,
      edit: input.edit,
      job: { status: "uploading", message: "Uploading" },
      upload: { fileName: input.fileName, size: input.size, received: 0 },
    });
    const project = { ...draft, job: { ...draft.job, stages: plannedStages(draft) } };
    await createProject(userId, project, await projectLimit(userId));
    return Response.json({ project, chunkBytes: UPLOAD_CHUNK_BYTES }, { status: 201 });
  },
  { rate: { bucket: "create", limit: 15, windowMs: 10 * 60_000 } },
);
