import { PROOF_LIMITS } from "@/lib/campaigns/schema";
import { myCampaign, saveProof } from "@/lib/server/campaigns";
import { HttpError, userRoute } from "@/lib/server/http";

/** A clipper's proof of their audience: screenshots, as form data ("images"), replacing any sent before. */
export const POST = userRoute<{ slug: string }>(
  async (req, { userId, params }) => {
    if (Number(req.headers.get("content-length") ?? 0) > PROOF_LIMITS.images * PROOF_LIMITS.bytes + 64 * 1024) throw new HttpError(413, "too_large", "Those screenshots are too large.");
    const form = await req.formData().catch(() => {
      throw new HttpError(400, "bad_request", "Send the screenshots as a form.");
    });
    const files = form.getAll("images").filter((f): f is File => f instanceof File);
    const images = await Promise.all(files.slice(0, PROOF_LIMITS.images + 1).map(async (f) => new Uint8Array(await f.arrayBuffer())));
    await saveProof(userId, params.slug, images);
    return Response.json(await myCampaign(userId, params.slug));
  },
  { rate: { bucket: "campaign-proof", limit: 10, windowMs: 60 * 60_000 } },
);
