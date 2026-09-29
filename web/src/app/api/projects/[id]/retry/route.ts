import { existsSync } from "node:fs";
import { HttpError, userRoute } from "@/lib/server/http";
import { plannedStages, startImport } from "@/lib/server/jobs";
import { isPrepared, mutateProject, paths } from "@/lib/server/store";

type Params = { id: string };

/** Try a failed import again, from wherever it can resume. */
export const POST = userRoute<Params>(
  async (_req, { userId, params }) => {
    const project = await mutateProject(userId, params.id, (p) => {
      if (p.job.status !== "failed") throw new HttpError(409, "not_failed", "This project isn’t in a failed state.");
      const files = paths(userId, p.id);
      const prepared = isPrepared(p) && existsSync(files.source);
      if (!prepared && p.source.live && !p.source.live.vodRange) {
        throw new HttpError(409, "live_gone", "A live recording can’t be redone once the moment has passed. Start a new capture from the stream.");
      }
      const canResume =
        prepared || p.source.kind === "url" || (p.upload !== undefined && p.upload.received === p.upload.size && existsSync(files.upload));
      if (!canResume) throw new HttpError(409, "upload_missing", "The uploaded file didn’t fully arrive. Start a new import and upload it again.");
      return { ...p, job: { status: "queued", progress: 0, message: "Waiting to start", updatedAt: Date.now(), stages: plannedStages(p) } };
    });
    startImport(userId, project.id);
    return Response.json(project);
  },
  { rate: { bucket: "create", limit: 15, windowMs: 10 * 60_000 } },
);
