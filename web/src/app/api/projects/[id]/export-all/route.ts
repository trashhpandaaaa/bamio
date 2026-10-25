import { createReadStream } from "node:fs";
import { batchExportSchema } from "@/lib/clips/schema";
import { uniqueNames, zipName, zipStream, ZIP_MAX_BYTES } from "@/lib/clips/zip";
import { assertClipFeature } from "@/lib/server/clip-access";
import { attachmentName, HttpError, readJson, userRoute } from "@/lib/server/http";
import { startExport } from "@/lib/server/jobs";
import { storage } from "@/lib/server/storage";
import { getProject, mediaKeys } from "@/lib/server/store";

type Params = { id: string };

/**
 * Export every clip of a project in one go (Starter: "Export every clip at once"), then
 * download the lot as a zip.
 *
 * POST queues a render for each clip that needs one and answers with how many are on their
 * way; the project's own clip states carry the progress, as a single export does, so the page
 * needs nothing new to follow them. A clip whose export is already up to date is left alone,
 * which is what makes asking again cheap.
 */
export const POST = userRoute<Params>(
  async (req, { userId, params }) => {
    await assertClipFeature(userId, "batch");
    const input = await readJson(req, batchExportSchema);
    const project = await getProject(userId, params.id);
    if (project.clips.length === 0) throw new HttpError(409, "no_clips", "This video has no clips to export yet.");
    const wanted = input.clipIds?.length ? project.clips.filter((c) => input.clipIds!.includes(c.id)) : project.clips;
    if (wanted.length === 0) throw new HttpError(404, "not_found", "Those clips don’t exist.");
    const queued: string[] = [];
    const failed: { clipId: string; error: string }[] = [];
    let first: HttpError | null = null;
    for (const clip of wanted) {
      // Already running: leave it be, so asking again costs nothing.
      if (clip.export?.status === "queued" || clip.export?.status === "rendering") continue;
      try {
        await startExport(userId, params.id, clip.id);
        queued.push(clip.id);
      } catch (err) {
        // One clip's problem (a plan gate, a bad range) shouldn't stop the rest.
        if (!(err instanceof HttpError)) throw err;
        first ??= err;
        failed.push({ clipId: clip.id, error: err.message });
      }
    }
    // Nothing got through: the first clip's reason is the answer, with its own status, so a
    // plan gate still reaches the page as a 402 and links to the plans.
    if (queued.length === 0 && first) throw first;
    return Response.json({ queued: queued.length, failed }, { status: 202 });
  },
  { rate: { bucket: "export-all", limit: 10, windowMs: 10 * 60_000 } },
);

/** Every finished export of the project as one zip, read from storage and sent as it is written. */
export const GET = userRoute<Params>(async (req, { userId, params }) => {
  await assertClipFeature(userId, "batch");
  const project = await getProject(userId, params.id);
  const only = new URL(req.url).searchParams.get("clips")?.split(",").filter(Boolean);
  const ready = project.clips.filter((c) => c.export?.status === "done" && (!only?.length || only.includes(c.id)));
  if (ready.length === 0) throw new HttpError(409, "none_ready", "No clip has finished exporting yet.");
  const total = ready.reduce((sum, c) => sum + (c.export?.bytes ?? 0), 0);
  if (total > ZIP_MAX_BYTES) throw new HttpError(413, "too_large", "These clips come to more than 4 GB together. Download them in smaller batches.");
  const keys = mediaKeys(userId, project.id);
  const names = uniqueNames(ready.map((c, i) => `${String(i + 1).padStart(2, "0")} ${zipName(c.title)}.mp4`));
  const entries = ready.map((clip, i) => ({ name: names[i]!, bytes: () => readKey(keys.export(clip.id)) }));
  return new Response(zipStream(entries), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${attachmentName(project.title, "zip")}"`,
      "cache-control": "private, no-store",
    },
  });
});

/**
 * One stored file, a chunk at a time, from whichever driver holds it: the file itself with
 * local storage, a signed link with S3. Nothing is held in memory, so the size of the zip is
 * only limited by what a zip can hold (ZIP_MAX_BYTES).
 */
async function* readKey(key: string): AsyncGenerator<Uint8Array> {
  const file = storage().localPath?.(key);
  if (file) {
    yield* createReadStream(file);
    return;
  }
  const res = await fetch(await storage().readable(key));
  if (!res.ok || !res.body) throw new HttpError(502, "read_failed", "One of the clips couldn’t be read. Try again.");
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
