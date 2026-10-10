import { serveDownload } from "@/lib/server/downloads";
import { userRoute } from "@/lib/server/http";

type Params = { id: string };

/** The finished file, to save (?view=1: to read in the browser, as the editor does): streamed, or a signed link to it. */
export const GET = userRoute<Params>((req, { userId, params }) => serveDownload(req, userId, params.id, new URL(req.url).searchParams.get("view") === "1"));
