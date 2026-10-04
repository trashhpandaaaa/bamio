import { aiConfigured, isMock } from "@/lib/ai/server/gemini";
import type { SystemStatus } from "@/lib/clips/schema";
import { adminOf } from "@/lib/server/admin";
import { billingEnabled } from "@/lib/server/billing";
import { binVersion } from "@/lib/server/bin";
import { emailMode } from "@/lib/server/email";
import { userRoute } from "@/lib/server/http";

/** Which parts of the app can run on this server (link import, video, AI, plans, emails), and whether this user is an admin. */
export const GET = userRoute(async (_req, { userId }) => {
  const [ytdlp, ffmpeg, admin] = await Promise.all([binVersion("yt-dlp"), binVersion("ffmpeg"), adminOf(userId).catch(() => null)]);
  const body: SystemStatus = {
    ytdlp,
    ffmpeg,
    ai: { configured: aiConfigured(), mock: isMock() },
    billing: billingEnabled(),
    email: emailMode() !== "off",
    admin: admin?.role ?? null,
  };
  return Response.json(body);
});
