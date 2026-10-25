import { translateSchema } from "@/lib/clips/schema";
import { assertClipFeature } from "@/lib/server/clip-access";
import { HttpError, readJson, userRoute } from "@/lib/server/http";
import { startTranslate } from "@/lib/server/jobs";
import { getProject } from "@/lib/server/store";
import { deleteTranslation, listTranslations, MAX_TRANSLATIONS, translationCode } from "@/lib/server/translate";

type Params = { id: string };

/** The languages this project's captions have been translated into. */
export const GET = userRoute<Params>(async (_req, { userId, params }) => {
  await getProject(userId, params.id); // 404s for someone else's project
  return Response.json({ languages: await listTranslations(userId, params.id) });
});

/**
 * Translate the project's captions into another language (Pro). Background work, like
 * transcribing: the job finishes and the language appears in GET. Uses no AI minutes, since
 * nothing is transcribed; it is one Gemini request per 60 phrases.
 */
export const POST = userRoute<Params>(
  async (req, { userId, params }) => {
    await assertClipFeature(userId, "translate");
    const input = await readJson(req, translateSchema);
    const existing = await listTranslations(userId, params.id);
    const code = translationCode(input.language);
    if (!existing.includes(code) && existing.length >= MAX_TRANSLATIONS) {
      throw new HttpError(409, "too_many", `A video can be translated into ${MAX_TRANSLATIONS} languages. Remove one to add another.`);
    }
    return Response.json(await startTranslate(userId, params.id, code), { status: 202 });
  },
  { rate: { bucket: "translate", limit: 20, windowMs: 60 * 60_000 } },
);

/** Remove a translation. Clips captioned in it fall back to the spoken language. */
export const DELETE = userRoute<Params>(async (req, { userId, params }) => {
  const language = new URL(req.url).searchParams.get("lang");
  if (!language) throw new HttpError(400, "bad_request", "Say which language to remove.");
  await getProject(userId, params.id);
  await deleteTranslation(userId, params.id, language);
  return Response.json({ languages: await listTranslations(userId, params.id) });
});
