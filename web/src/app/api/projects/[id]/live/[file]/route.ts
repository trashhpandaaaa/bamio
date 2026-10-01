import path from "node:path";
import { isFollowing } from "@/lib/clips/schema";
import { serveFile } from "@/lib/server/files";
import { HttpError, userRoute } from "@/lib/server/http";
import { LIVE_FILE, LIVE_PLAYLIST } from "@/lib/server/live";
import { getProject, paths } from "@/lib/server/store";

type Params = { id: string; file: string };

/**
 * A followed stream's video while it grows, as HLS for the player: the playlist (always
 * fresh), its init segment and its media segments (which never change). Only those file
 * names are served.
 */
export const GET = userRoute<Params>(
  async (req, { userId, params }) => {
    if (!LIVE_FILE.test(params.file)) throw new HttpError(404, "not_found", "No such file.");
    const project = await getProject(userId, params.id);
    if (!isFollowing(project)) throw new HttpError(404, "not_following", "This project isn’t following a stream.");
    const file = path.join(paths(userId, project.id).live, params.file);
    if (params.file === LIVE_PLAYLIST) return serveFile(req, file, { type: "application/vnd.apple.mpegurl", maxAge: 0 });
    return serveFile(req, file, { type: "video/mp4", maxAge: 86_400 });
  },
  // The player fetches a segment every few seconds, and more while seeking.
  { rate: { bucket: "live", limit: 1200, windowMs: 60_000 } },
);
