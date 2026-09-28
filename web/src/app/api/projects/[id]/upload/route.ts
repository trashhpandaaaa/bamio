import { open } from "node:fs/promises";
import { UPLOAD_CHUNK_BYTES } from "@/lib/clips/schema";
import { HttpError, userRoute } from "@/lib/server/http";
import { startImport } from "@/lib/server/jobs";
import { mutateProject, paths } from "@/lib/server/store";

type Params = { id: string };

/**
 * Append one chunk of an upload: PUT ?offset=<bytes already sent> with the raw bytes.
 * Chunks must arrive in order; a repeated chunk is accepted and ignored, so the
 * browser can safely retry. Answers with how many bytes the server has.
 */
export const PUT = userRoute<Params>(
  async (req, { userId, params }) => {
    const offset = Number(new URL(req.url).searchParams.get("offset"));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, "bad_request", "Missing upload offset.");
    if (Number(req.headers.get("content-length") ?? 0) > UPLOAD_CHUNK_BYTES) throw new HttpError(413, "too_large", "Upload chunk too large.");
    const chunk = Buffer.from(await req.arrayBuffer());
    if (chunk.length === 0 || chunk.length > UPLOAD_CHUNK_BYTES) throw new HttpError(400, "bad_request", "Upload chunk is empty or too large.");

    let complete = false;
    const project = await mutateProject(userId, params.id, async (p) => {
      if (p.job.status !== "uploading" || !p.upload) throw new HttpError(409, "not_uploading", "This project isn’t waiting for an upload.");
      const { size, received } = p.upload;
      if (offset + chunk.length <= received) return p; // A retry of a chunk we already have.
      if (offset !== received) throw new HttpError(409, "bad_offset", `Expected the upload to continue at byte ${received}.`);
      if (offset + chunk.length > size) throw new HttpError(400, "bad_request", "The upload is bigger than announced.");
      const file = await open(paths(userId, p.id).upload, offset === 0 ? "w" : "r+");
      try {
        await file.write(chunk, 0, chunk.length, offset);
      } finally {
        await file.close();
      }
      const now = received + chunk.length;
      complete = now === size;
      return {
        ...p,
        upload: { ...p.upload, received: now },
        job: complete
          ? { status: "queued", progress: 0, message: "Waiting to start", updatedAt: Date.now(), stages: p.job.stages }
          : { ...p.job, progress: now / size, updatedAt: Date.now() },
      };
    });
    if (complete) startImport(userId, project.id);
    return Response.json({ received: project.upload?.received ?? project.upload?.size ?? 0, complete });
  },
  { rate: { bucket: "upload", limit: 2000, windowMs: 60_000 } },
);
