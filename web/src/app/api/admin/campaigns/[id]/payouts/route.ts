import { z } from "zod";
import { CAMPAIGN_LIMITS } from "@/lib/campaigns/schema";
import { adminRoute } from "@/lib/server/admin";
import { recordPayout } from "@/lib/server/campaigns";
import { readJson } from "@/lib/server/http";

const body = z.object({
  userId: z.string().min(1).max(80),
  amountCents: z.number().int().positive().max(CAMPAIGN_LIMITS.budgetCents),
  note: z
    .string()
    .max(CAMPAIGN_LIMITS.note)
    .transform((s) => s.replace(/\s+/g, " ").trim()),
});

/** Write down a payment made to a clipper outside Bamio (admins). */
export const POST = adminRoute<{ id: string }>(async (req, { admin, params }) => {
  const { userId, amountCents, note } = await readJson(req, body);
  await recordPayout(admin, params.id, userId, amountCents, note);
  return Response.json({ ok: true }, { status: 201 });
});
