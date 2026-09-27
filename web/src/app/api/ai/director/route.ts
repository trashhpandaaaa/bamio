import { directorOutputSchema, directorRequestSchema } from "@/lib/ai/contracts";
import { generateJson, isMock } from "@/lib/ai/server/gemini";
import { mockDirector } from "@/lib/ai/server/mock";
import { DIRECTOR_SCHEMA, DIRECTOR_SYSTEM, directorPrompt } from "@/lib/ai/server/prompts";
import { aiRoute } from "@/lib/ai/server/route";

export const maxDuration = 60;

export const POST = aiRoute(directorRequestSchema, async (input, signal) => {
  const output = isMock()
    ? mockDirector(input)
    : await generateJson({
        system: DIRECTOR_SYSTEM,
        prompt: directorPrompt(input),
        schema: DIRECTOR_SCHEMA,
        parse: (v) => directorOutputSchema.parse(v),
        temperature: 0.5,
        signal,
      });
  // Notes may only point at scenes that exist.
  const notes = output.notes.map((n) => (n.scene > input.scenes.length || n.scene < 0 ? { ...n, scene: 0 } : n));
  return { summary: output.summary, notes };
});
