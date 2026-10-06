import { z } from "zod";
import { CAMPAIGN_LIMITS } from "@/lib/campaigns/schema";
import { adminRoute } from "@/lib/server/admin";
import { recountClip, reviewClip, setClipViews } from "@/lib/server/campaigns";
import { HttpError, readJson } from "@/lib/server/http";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({
    action: z.literal("reject"),
    note: z
      .string()
      .max(CAMPAIGN_LIMITS.note)
      .transform((s) => s.replace(/\s+/g, " ").trim()),
  }),
  z.object({ action: z.literal("views"), views: z.number().int().min(0).max(CAMPAIGN_LIMITS.views).nullable() }),
  z.object({ action: z.literal("recount") }),
]);

/** Approve or reject a campaign clip, set its views by hand, or have them read again (admins). */
export const POST = adminRoute<{ clipId: string }>(async (req, { admin, params }) => {
  if (!/^\d{1,12}$/.test(params.clipId)) throw new HttpError(404, "not_found", "That clip isn’t there any more.");
  const id = Number(params.clipId);
  const change = await readJson(req, body);
  if (change.action === "approve") await reviewClip(admin, id, "approve");
  else if (change.action === "reject") await reviewClip(admin, id, "reject", change.note);
  else if (change.action === "views") await setClipViews(admin, id, change.views);
  else await recountClip(id);
  return Response.json({ ok: true });
});
