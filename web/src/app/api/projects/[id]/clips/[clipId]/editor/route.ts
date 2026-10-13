import { editorSource } from "@/lib/server/editor-source";
import { userRoute } from "@/lib/server/http";

type Params = { id: string; clipId: string };

/** Cut the clip out for the editor and say how to set it up there, captions as words (Starter). */
export const POST = userRoute<Params>(async (_req, { userId, params }) => Response.json(await editorSource(userId, params.id, params.clipId)), {
  rate: { bucket: "editor-source", limit: 30, windowMs: 10 * 60_000 },
});
