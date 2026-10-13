import { serveEditorCut } from "@/lib/server/editor-source";
import { userRoute } from "@/lib/server/http";

type Params = { id: string; clipId: string };

/** The clip's cut, made by POST ../editor, for the editor to read. */
export const GET = userRoute<Params>((req, { userId, params }) => serveEditorCut(req, userId, params.id, params.clipId));
