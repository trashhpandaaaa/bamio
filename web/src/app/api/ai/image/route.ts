import { imageRequestSchema } from "@/lib/ai/contracts";
import { generateImage, isMock } from "@/lib/ai/server/gemini";
import { mockImage } from "@/lib/ai/server/mock";
import { imagePrompt } from "@/lib/ai/server/prompts";
import { aiRoute } from "@/lib/ai/server/route";

export const maxDuration = 120;

export const POST = aiRoute(imageRequestSchema, async (input, signal) =>
  isMock() ? mockImage(input) : generateImage(imagePrompt(input), signal),
);
