import { clerkClient } from "@clerk/nextjs/server";
import { clipperInputSchema } from "@/lib/campaigns/schema";
import { myClipper, saveClipper } from "@/lib/server/campaigns";
import { readJson, userRoute } from "@/lib/server/http";

/** The signed-in user's clipper details (null: they've never joined a campaign). */
export const GET = userRoute(async (_req, { userId }) => Response.json(await myClipper(userId)));

/** Save them: the name and channel campaigns show, and how to pay them (for admins only). Their Clerk picture goes with it. */
export const PUT = userRoute(
  async (req, { userId }) => {
    const input = await readJson(req, clipperInputSchema);
    const user = await (await clerkClient()).users.getUser(userId);
    return Response.json(await saveClipper(userId, input, user.hasImage ? user.imageUrl : null));
  },
  { rate: { bucket: "clipper", limit: 20, windowMs: 10 * 60_000 } },
);
