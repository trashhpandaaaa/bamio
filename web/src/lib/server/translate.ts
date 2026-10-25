import "server-only";
import { translateLines } from "@/lib/ai/server/translate-ai";
import { isAutoLanguage, languageName } from "@/lib/clips/languages";
import { applyTranslation, translationBatches, translationLooksDone, wordCount } from "@/lib/clips/translate";
import { transcriptSchema, type Project, type Transcript } from "@/lib/clips/schema";
import { db } from "@/lib/server/db";
import { HttpError } from "@/lib/server/http";
import { projectDir, readTranscript } from "@/lib/server/store";

/*
 * A project's transcript translated into another language, so its clips can be captioned in it
 * (Pro: "Captions in another language"). One row per project and language (clip_translations,
 * migration 0018), made by the "translate" job and kept until the project goes.
 *
 * The translation is a transcript in its own right, with the same phrase times, so everything
 * downstream (captionLines, the ASS builder, the fonts chosen per script, the subtitle files)
 * works on it unchanged. What it does not have is per-word times: see lib/clips/translate.ts.
 */

/** How many languages one project may be translated into, so a project can't fill the table. */
export const MAX_TRANSLATIONS = 10;

/** A language code as it is stored: lowercase, no region. */
export const translationCode = (language: string) => language.trim().toLowerCase().split(/[-_]/)[0]!.slice(0, 20);

export async function readTranslation(userId: string, projectId: string, language: string): Promise<Transcript | null> {
  projectDir(userId, projectId);
  const [row] = await db()<{ data: unknown }[]>`
    select t.data from clip_translations t join projects p on p.id = t.project_id
    where t.project_id = ${projectId} and t.lang = ${translationCode(language)} and p.user_id = ${userId}`;
  if (!row) return null;
  const parsed = transcriptSchema.safeParse(row.data);
  return parsed.success ? parsed.data : null;
}

/** The languages a project has been translated into, in the order they were made. */
export async function listTranslations(userId: string, projectId: string): Promise<string[]> {
  projectDir(userId, projectId);
  const rows = await db()<{ lang: string }[]>`
    select t.lang from clip_translations t join projects p on p.id = t.project_id
    where t.project_id = ${projectId} and p.user_id = ${userId} order by t.updated_at`;
  return rows.map((r) => r.lang);
}

async function writeTranslation(userId: string, projectId: string, language: string, transcript: Transcript) {
  projectDir(userId, projectId);
  const doc = transcriptSchema.parse(transcript);
  const sql = db();
  const written = await sql`
    insert into clip_translations (project_id, lang, data, updated_at)
    select id, ${translationCode(language)}, ${sql.json(JSON.parse(JSON.stringify(doc)))}, ${Date.now()} from projects where id = ${projectId} and user_id = ${userId}
    on conflict (project_id, lang) do update set data = excluded.data, updated_at = excluded.updated_at`;
  if (written.count === 0) throw new HttpError(404, "not_found", "That project doesn’t exist, or it was deleted.");
}

export async function deleteTranslation(userId: string, projectId: string, language: string) {
  projectDir(userId, projectId);
  await db()`
    delete from clip_translations where project_id = ${projectId} and lang = ${translationCode(language)}
    and project_id in (select id from projects where user_id = ${userId})`;
}

/** Why a language can't be translated into, or null. */
export function translationProblem(language: string, spoken: string | undefined): string | null {
  const code = translationCode(language);
  if (!code || isAutoLanguage(code)) return "Choose a language to translate into.";
  if (!isAutoLanguage(spoken) && translationCode(spoken!) === code) return `This video is already in ${languageName(code)}.`;
  return null;
}

/**
 * Translate the project's transcript, a batch of phrases at a time. Safe to run again: the
 * row is replaced, not added to, and a batch that comes back short keeps the phrases it
 * didn't answer for (applyTranslation), so a caption is never left empty.
 */
export async function runTranslate(userId: string, projectId: string, language: string, signal: AbortSignal, onProgress?: (v: number) => void): Promise<void> {
  const code = translationCode(language);
  const transcript = await readTranscript(userId, projectId);
  if (!transcript || transcript.segments.length === 0) throw new HttpError(409, "no_transcript", "This video has no captions to translate yet.");
  const batches = translationBatches(transcript.segments);
  const texts: string[] = new Array(transcript.segments.length).fill("");
  let done = 0;
  for (const batch of batches) {
    signal.throwIfAborted();
    const lines = await translateLines(batch.texts, code, { from: transcript.language, signal });
    lines.forEach((text, i) => {
      texts[batch.from + i] = text;
    });
    onProgress?.(++done / batches.length);
  }
  const translated = applyTranslation(transcript, texts, code);
  if (!translationLooksDone(transcript.segments, translated.segments)) {
    throw new HttpError(502, "translation_failed", `The translation into ${languageName(code)} came back unusable. Try again.`);
  }
  await writeTranslation(userId, projectId, code, translated);
  console.log(`[bamio/translate] ${projectId} into ${code}: ${translated.segments.length} phrases, ${wordCount(translated.segments)} words`);
}

/** The transcript a clip's captions come from: its chosen language's translation, or the spoken one. */
export async function captionsFor(userId: string, project: Project, captionLanguage: string | undefined): Promise<Transcript | null> {
  if (!project.hasTranscript) return null;
  if (captionLanguage) {
    const translated = await readTranslation(userId, project.id, captionLanguage);
    // A clip asking for a language that was deleted falls back to the spoken one rather than
    // exporting with no captions at all.
    if (translated) return translated;
  }
  return readTranscript(userId, project.id);
}
