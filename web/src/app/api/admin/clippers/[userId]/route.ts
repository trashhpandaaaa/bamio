import { z } from "zod";
import { adminRoute } from "@/lib/server/admin";
import { blockClipper } from "@/lib/server/campaigns";
import { readJson } from "@/lib/server/http";

/** Block a clipper from campaigns, or let them back (admins). */
export const POST = adminRoute<{ userId: string }>(async (req, { admin, params }) => {
  const { action } = await readJson(req, z.object({ action: z.enum(["block", "unblock"]) }));
  await blockClipper(admin, params.userId, action === "block");
  return Response.json({ ok: true });
});
