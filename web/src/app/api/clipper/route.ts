import { clerkClient } from "@clerk/nextjs/server";
import { clipperInputSchema } from "@/lib/profile/clipper";
import { myClipper, removeClipper, saveClipper } from "@/lib/server/clippers";
import { readJson, userRoute } from "@/lib/server/http";

const rate = { bucket: "clipper", limit: 20, windowMs: 10 * 60_000 };

/** The signed-in user's entry on the Clippers page (null: not listed). */
export const GET = userRoute(async (_req, { userId }) => Response.json(await myClipper(userId)));

/** List them, or change their entry: it waits for an admin before it shows. Their Clerk picture goes with it. */
export const PUT = userRoute(
  async (req, { userId }) => {
    const input = await readJson(req, clipperInputSchema);
    const user = await (await clerkClient()).users.getUser(userId);
    return Response.json(await saveClipper(userId, input, user.hasImage ? user.imageUrl : null));
  },
  { rate },
);

/** Take them off the page. */
export const DELETE = userRoute(
  async (_req, { userId }) => {
    await removeClipper(userId);
    return new Response(null, { status: 204 });
  },
  { rate },
);
