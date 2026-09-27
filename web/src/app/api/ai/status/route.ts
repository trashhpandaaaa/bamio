import { aiStatus } from "@/lib/ai/server/gemini";

/** Tells the UI whether AI is available (never exposes the key). */
export function GET() {
  return Response.json(aiStatus(), { headers: { "cache-control": "no-store" } });
}
