import { CAPTION_LIMITS, startCaptions } from "@/lib/server/editor-captions";
import { HttpError, userRoute } from "@/lib/server/http";

/**
 * Auto captions (Pro): the body is the sound of the parts an edit uses, as a WAV; ?language=
 * names its language (or "auto"). Answers with the job's id, to ask after.
 */
export const POST = userRoute(
  async (req, { userId }) => {
    const size = Number(req.headers.get("content-length") ?? 0);
    if (size > CAPTION_LIMITS.maxBytes) throw new HttpError(413, "too_long", `Captions can be made for up to ${CAPTION_LIMITS.maxSec / 60} minutes of sound at once.`);
    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength === 0) throw new HttpError(400, "bad_request", "No sound came with that.");
    const id = await startCaptions(userId, body, { language: new URL(req.url).searchParams.get("language") ?? undefined });
    return Response.json({ id }, { status: 202 });
  },
  { rate: { bucket: "editor-captions", limit: 20, windowMs: 60 * 60_000 } },
);
