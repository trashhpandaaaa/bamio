import { z } from "zod";
import { CAMPAIGN_LIMITS } from "@/lib/campaigns/schema";
import { adminRoute } from "@/lib/server/admin";
import { reviewProof } from "@/lib/server/campaigns";
import { readJson } from "@/lib/server/http";

const body = z.object({
  accept: z.boolean(),
  note: z
    .string()
    .max(CAMPAIGN_LIMITS.note * 2)
    .default("")
    .transform((s) => s.replace(/\s+/g, " ").trim().slice(0, CAMPAIGN_LIMITS.note)),
});

/** Accept a clipper's audience proof, or reject it with a word about why (admins). */
export const POST = adminRoute<{ id: string; userId: string }>(async (req, { admin, params }) => {
  const { accept, note } = await readJson(req, body);
  await reviewProof(admin, params.id, params.userId, accept, note);
  return Response.json({ ok: true });
});
