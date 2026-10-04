import { z } from "zod";
import { adminJobAction, adminRoute } from "@/lib/server/admin";
import { HttpError, readJson } from "@/lib/server/http";

type Params = { id: string };
const body = z.object({ action: z.enum(["retry", "cancel"]) });

/** Retry or cancel a job (admins). */
export const POST = adminRoute<Params>(async (req, { admin, params }) => {
  const id = Number(params.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(404, "not_found", "No such job.");
  const { action } = await readJson(req, body);
  await adminJobAction(admin, id, action);
  return Response.json({ ok: true });
});
