import { adminRoute } from "@/lib/server/admin";
import { serveProof } from "@/lib/server/campaigns";

/** One of a clipper's audience screenshots (admins only). */
export const GET = adminRoute<{ id: string; userId: string; n: string }>(async (req, { params }) => serveProof(req, params.id, params.userId, Number(params.n)));
