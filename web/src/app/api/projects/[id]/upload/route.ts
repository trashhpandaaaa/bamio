import { UPLOAD_CHUNK_BYTES } from "@/lib/clips/schema";
import { HttpError, userRoute } from "@/lib/server/http";
import { startImport } from "@/lib/server/jobs";
import { storage } from "@/lib/server/storage";
import { mediaKeys, mutateProject } from "@/lib/server/store";

type Params = { id: string };

/**
 * Append one chunk of an upload: PUT ?offset=<bytes already sent> with the raw bytes.
 * Chunks must arrive in order; a repeated chunk is accepted and ignored, so the
 * browser can safely retry. Answers with how many bytes the server has. Each chunk is
 * one part of the upload in storage (all but the last are UPLOAD_CHUNK_BYTES, which S3
 * needs to be 5 MB or more); the last one finishes it.
 */
export const PUT = userRoute<Params>(
  async (req, { userId, params }) => {
    const offset = Number(new URL(req.url).searchParams.get("offset"));
    if (!Number.isSafeInteger(offset) || offset < 0) throw new HttpError(400, "bad_request", "Missing upload offset.");
    if (Number(req.headers.get("content-length") ?? 0) > UPLOAD_CHUNK_BYTES) throw new HttpError(413, "too_large", "Upload chunk too large.");
    const chunk = Buffer.from(await req.arrayBuffer());
    if (chunk.length === 0 || chunk.length > UPLOAD_CHUNK_BYTES) throw new HttpError(400, "bad_request", "Upload chunk is empty or too large.");

    let complete = false;
    const key = mediaKeys(userId, params.id).upload;
    const project = await mutateProject(userId, params.id, async (p) => {
      if (p.job.status !== "uploading" || !p.upload?.uploadId) throw new HttpError(409, "not_uploading", "This project isn’t waiting for an upload.");
      const { size, received, uploadId } = p.upload;
      if (offset + chunk.length <= received) return p; // A retry of a chunk we already have.
      if (offset !== received) throw new HttpError(409, "bad_offset", `Expected the upload to continue at byte ${received}.`);
      if (offset + chunk.length > size) throw new HttpError(400, "bad_request", "The upload is bigger than announced.");
      // Every chunk but the last is exactly UPLOAD_CHUNK_BYTES, so its part number follows from where it starts.
      if (offset % UPLOAD_CHUNK_BYTES !== 0 || (offset + chunk.length < size && chunk.length !== UPLOAD_CHUNK_BYTES)) {
        throw new HttpError(400, "bad_request", `Send the file in chunks of ${UPLOAD_CHUNK_BYTES} bytes.`);
      }
      const n = offset / UPLOAD_CHUNK_BYTES + 1;
      const etag = await storage().uploadPart(key, uploadId, n, offset, chunk);
      const parts = [...(p.upload.parts ?? []).filter((part) => part.n !== n), { n, etag }];
      const now = received + chunk.length;
      complete = now === size;
      if (complete) await storage().finishUpload(key, uploadId, parts);
      return {
        ...p,
        upload: { ...p.upload, received: now, parts },
        job: complete
          ? { status: "queued", progress: 0, message: "Waiting to start", updatedAt: Date.now(), stages: p.job.stages }
          : { ...p.job, progress: now / size, updatedAt: Date.now() },
      };
    });
    if (complete) await startImport(userId, project.id);
    return Response.json({ received: project.upload?.received ?? project.upload?.size ?? 0, complete });
  },
  { rate: { bucket: "upload", limit: 2000, windowMs: 60_000 } },
);
