import { z } from "zod";
import { addAdmin, adminRoute } from "@/lib/server/admin";
import { readJson } from "@/lib/server/http";

const body = z.object({ email: z.string().trim().email().max(320) });

/** Make someone an admin, by the email address of their Bamio account (superadmins only). */
export const POST = adminRoute(
  async (req, { admin }) => {
    const { email } = await readJson(req, body);
    const user = await addAdmin(admin, email);
    return Response.json({ userId: user.id, email: user.email });
  },
  { role: "superadmin" },
);
