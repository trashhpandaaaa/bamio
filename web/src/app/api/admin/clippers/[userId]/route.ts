import { z } from "zod";
import { adminRoute } from "@/lib/server/admin";
import { reviewClipper } from "@/lib/server/clippers";
import { readJson } from "@/lib/server/http";

type Params = { userId: string };
const body = z.object({ action: z.enum(["approve", "hide"]) });

/** Approve someone's entry for the Clippers page, or hide it (admins). */
export const POST = adminRoute<Params>(async (req, { admin, params }) => {
  const { action } = await readJson(req, body);
  await reviewClipper(admin, params.userId, action);
  return Response.json({ ok: true });
});
