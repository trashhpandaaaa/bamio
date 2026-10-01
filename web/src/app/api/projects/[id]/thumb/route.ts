import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { serveFile } from "@/lib/server/files";
import { HttpError, userRoute } from "@/lib/server/http";
import { withFrameLimit, withSourceFile } from "@/lib/server/jobs";
import { extractFrame } from "@/lib/server/media";
import { getProject, isPrepared, paths } from "@/lib/server/store";

type Params = { id: string };

/** The project thumbnail, or with ?t=<seconds> a frame at that time (cached, used for clip cards). */
export const GET = userRoute<Params>(async (req, { userId, params }) => {
  const project = await getProject(userId, params.id);
  const files = paths(userId, project.id);
  const t = new URL(req.url).searchParams.get("t");
  if (t === null) return serveFile(req, files.thumb, { type: "image/jpeg", maxAge: 3600 });

  const seconds = Number(t);
  if (!isPrepared(project) || !Number.isFinite(seconds) || seconds < 0 || seconds > project.source.durationSec) {
    throw new HttpError(404, "not_found", "No frame there.");
  }
  // Tenths of a second, so nearby requests share one file.
  const frame = path.join(files.frames, `${Math.round(seconds * 10)}.jpg`);
  if (!existsSync(frame)) {
    await mkdir(files.frames, { recursive: true });
    // A followed stream: from its video so far.
    await withFrameLimit(() => (existsSync(frame) ? Promise.resolve() : withSourceFile(userId, project, (file) => extractFrame(file, frame, seconds, 480))));
  }
  return serveFile(req, frame, { type: "image/jpeg", maxAge: 86_400 });
}, { rate: { bucket: "frames", limit: 600, windowMs: 60_000 } });
