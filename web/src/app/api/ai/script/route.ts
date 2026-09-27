import { scriptOutputSchema, scriptRequestSchema } from "@/lib/ai/contracts";
import { generateJson, isMock } from "@/lib/ai/server/gemini";
import { mockScript } from "@/lib/ai/server/mock";
import { SCRIPT_SCHEMA, SCRIPT_SYSTEM, scriptPrompt } from "@/lib/ai/server/prompts";
import { aiRoute } from "@/lib/ai/server/route";

export const maxDuration = 60;

export const POST = aiRoute(scriptRequestSchema, async (input, signal) => {
  const script = isMock()
    ? mockScript(input)
    : await generateJson({
        system: SCRIPT_SYSTEM,
        prompt: scriptPrompt(input),
        schema: SCRIPT_SCHEMA,
        parse: (v) => scriptOutputSchema.parse(v),
        temperature: 0.8,
        signal,
      });
  // Without a voice-over the script must not carry spoken lines.
  if (!input.brief.voiceover) script.scenes = script.scenes.map((s) => ({ ...s, voiceover: "" }));
  return script;
});
