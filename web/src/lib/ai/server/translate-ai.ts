import "server-only";
import { z } from "zod";
import { generateJson, isMock } from "@/lib/ai/server/gemini";
import { languageName } from "@/lib/clips/languages";

/*
 * Translating caption phrases (Pro: "Captions in another language"). One request per batch of
 * phrases (lib/clips/translate.ts decides the batches), numbered so a phrase that comes back
 * out of order, or not at all, is spotted instead of being lined up against the wrong moment.
 *
 * The model is asked to keep each phrase a phrase: a caption has a second or two on screen,
 * so a translation that turns six words into a sentence of twenty is no use, however correct.
 */

const answer = z.object({
  lines: z.array(z.object({ n: z.number().int().min(1), text: z.string().max(2000) })).max(200),
});

const JSON_SCHEMA = {
  type: "object",
  properties: {
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer", description: "The number of the line being translated" },
          text: { type: "string", description: "That line translated" },
        },
        required: ["n", "text"],
      },
    },
  },
  required: ["lines"],
};

const SYSTEM = `You translate video captions.
Translate each numbered line into the target language and return every line, with its own number.
Keep a line's meaning, its tone and its register, swearing and slang included: these are captions of real speech, not a formal document.
Keep each line about as short as it was, so it still fits on screen for the time it is shown. Never merge lines, split lines, add lines or leave one out.
Translate names of people, places and brands only where that language normally does.
A line that is already in the target language, or that is only a sound or a number, comes back unchanged.
Return the translation alone: no notes, no romanisation, no explanations, no quotation marks that were not there.`;

/**
 * `texts` translated into `to`, in the same order and the same number. A line the model leaves
 * out comes back as an empty string, and the caller keeps the original for it.
 */
export async function translateLines(texts: string[], to: string, opts: { from?: string; title?: string; signal?: AbortSignal } = {}): Promise<string[]> {
  if (texts.length === 0) return [];
  if (isMock()) return texts.map((text) => mockTranslate(text, to));
  const target = languageName(to) || to;
  const source = opts.from ? languageName(opts.from) || opts.from : null;
  const result = await generateJson({
    task: `translate ${texts.length} lines to ${to}`,
    system: SYSTEM,
    prompt: [
      opts.title ? `These are captions from "${opts.title}".` : "",
      source ? `They are spoken in ${source}, and may be lowercase and unpunctuated.` : "",
      `Translate every line into ${target}. Return all ${texts.length} lines, numbered as they are here.`,
      "",
      ...texts.map((text, i) => `${i + 1} ${text}`),
    ]
      .filter(Boolean)
      .join("\n"),
    schema: JSON_SCHEMA,
    parse: (v) => answer.parse(v),
    thinking: "low",
    maxOutputTokens: 16_384,
    signal: opts.signal,
  });
  const byNumber = new Map(result.lines.map((l) => [l.n, l.text]));
  return texts.map((_, i) => (byNumber.get(i + 1) ?? "").replace(/\s+/g, " ").trim());
}

/**
 * Without a Gemini key (BAMIO_AI_MOCK=1): the words reversed, with the language's code. It is
 * plainly not a translation, it is different from the original, and it is the same every time,
 * which is what the tests need.
 */
export function mockTranslate(text: string, to: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean).reverse();
  return words.length > 0 ? `[${to}] ${words.join(" ")}` : "";
}
