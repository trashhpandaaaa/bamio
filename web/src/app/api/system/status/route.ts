import { aiConfigured, isMock } from "@/lib/ai/server/gemini";
import type { SystemStatus } from "@/lib/clips/schema";
import { billingEnabled } from "@/lib/server/billing";
import { binVersion } from "@/lib/server/bin";
import { userRoute } from "@/lib/server/http";

/** Which parts of the app can run on this server: link import (yt-dlp), video (ffmpeg), AI, plans. */
export const GET = userRoute(async () => {
  const [ytdlp, ffmpeg] = await Promise.all([binVersion("yt-dlp"), binVersion("ffmpeg")]);
  const body: SystemStatus = { ytdlp, ffmpeg, ai: { configured: aiConfigured(), mock: isMock() }, billing: billingEnabled() };
  return Response.json(body);
});
