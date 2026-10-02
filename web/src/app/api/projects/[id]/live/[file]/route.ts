import { isFollowing } from "@/lib/clips/schema";
import { HttpError, userRoute } from "@/lib/server/http";
import { LIVE_FILE, LIVE_PLAYLIST } from "@/lib/server/live";
import { storage } from "@/lib/server/storage";
import { getProject, mediaKeys } from "@/lib/server/store";

type Params = { id: string; file: string };

/**
 * A followed stream's video while it grows, as HLS for the player: the playlist (always
 * fresh), its init segment and its media segments (which never change). Only those file
 * names are served, always through this server (the player fetches them with XHR, which a
 * redirect to object storage would need CORS for).
 */
export const GET = userRoute<Params>(
  async (req, { userId, params }) => {
    if (!LIVE_FILE.test(params.file)) throw new HttpError(404, "not_found", "No such file.");
    const project = await getProject(userId, params.id);
    if (!isFollowing(project)) throw new HttpError(404, "not_following", "This project isn’t following a stream.");
    const key = `${mediaKeys(userId, project.id).live}/${params.file}`;
    if (params.file === LIVE_PLAYLIST) return storage().serve(req, key, { type: "application/vnd.apple.mpegurl", maxAge: 0, proxy: true });
    return storage().serve(req, key, { type: "video/mp4", maxAge: 86_400, proxy: true });
  },
  // The player fetches a segment every few seconds, and more while seeking.
  { rate: { bucket: "live", limit: 1200, windowMs: 60_000 } },
);
