import { adminRoute, removeAdmin } from "@/lib/server/admin";

type Params = { userId: string };

/** Stop someone being an admin (superadmins only). */
export const DELETE = adminRoute<Params>(
  async (_req, { admin, params }) => {
    await removeAdmin(admin, params.userId);
    return Response.json({ ok: true });
  },
  { role: "superadmin" },
);
