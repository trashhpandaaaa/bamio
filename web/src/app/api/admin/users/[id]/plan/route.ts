import { z } from "zod";
import { planIdSchema } from "@/lib/billing/plans";
import { adminRoute, setPlanGrant, userById } from "@/lib/server/admin";
import { HttpError, readJson } from "@/lib/server/http";

type Params = { id: string };
const body = z.object({ plan: planIdSchema.nullable() });

/** Give a user a plan for free, or take it back (superadmins only). */
export const POST = adminRoute<Params>(
  async (req, { admin, params }) => {
    const { plan } = await readJson(req, body);
    const user = await userById(params.id);
    if (!user) throw new HttpError(404, "not_found", "No such user.");
    await setPlanGrant(admin, user.id, user.email, plan);
    return Response.json({ ok: true });
  },
  { role: "superadmin" },
);
