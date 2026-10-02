import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { HttpError, userRoute } from "@/lib/server/http";
import { withFrameLimit, withSourceFile } from "@/lib/server/jobs";
import { extractFrame } from "@/lib/server/media";
import { storage } from "@/lib/server/storage";
import { getProject, isPrepared, mediaKeys, scratch } from "@/lib/server/store";

type Params = { id: string };

/** The project thumbnail, or with ?t=<seconds> a frame at that time (made once, then kept in storage; used for clip cards and the trim bar). */
export const GET = userRoute<Params>(
  async (req, { userId, params }) => {
    const project = await getProject(userId, params.id);
    const keys = mediaKeys(userId, project.id);
    const t = new URL(req.url).searchParams.get("t");
    if (t === null) return storage().serve(req, keys.thumb, { type: "image/jpeg", maxAge: 3600 });

    const seconds = Number(t);
    if (!isPrepared(project) || !Number.isFinite(seconds) || seconds < 0 || seconds > project.source.durationSec) {
      throw new HttpError(404, "not_found", "No frame there.");
    }
    // Tenths of a second, so nearby requests share one frame.
    const tenths = Math.round(seconds * 10);
    const key = keys.frame(tenths);
    if (!(await storage().stat(key))) {
      await withFrameLimit(async () => {
        if (await storage().stat(key)) return;
        const dir = scratch(project.id).frames;
        const file = path.join(dir, `${tenths}-${Math.random().toString(36).slice(2)}.jpg`);
        await mkdir(dir, { recursive: true });
        try {
          // A followed stream: from its video so far.
          await withSourceFile(userId, project, (input) => extractFrame(input, file, seconds, 480));
          await storage().publish(key, file, "image/jpeg");
        } finally {
          await rm(file, { force: true });
        }
      });
    }
    return storage().serve(req, key, { type: "image/jpeg", maxAge: 86_400 });
  },
  { rate: { bucket: "frames", limit: 600, windowMs: 60_000 } },
);
