import { hooksOutputSchema, hooksRequestSchema } from "@/lib/ai/contracts";
import { AiError, generateJson, isMock } from "@/lib/ai/server/gemini";
import { mockHooks } from "@/lib/ai/server/mock";
import { HOOKS_SCHEMA, HOOKS_SYSTEM, hooksPrompt } from "@/lib/ai/server/prompts";
import { aiRoute } from "@/lib/ai/server/route";
import { newId } from "@/lib/ids";

export const maxDuration = 60;

export const POST = aiRoute(hooksRequestSchema, async ({ brief }, signal) => {
  const output = isMock()
    ? mockHooks(brief)
    : await generateJson({
        system: HOOKS_SYSTEM,
        prompt: hooksPrompt(brief),
        schema: HOOKS_SCHEMA,
        parse: (v) => hooksOutputSchema.parse(v),
        signal,
      });
  if (output.hooks.length === 0) throw new AiError("bad_output", "Gemini did not suggest any hooks. Try again.", 502);
  return { hooks: output.hooks.map((h) => ({ id: newId(), ...h })) };
});
