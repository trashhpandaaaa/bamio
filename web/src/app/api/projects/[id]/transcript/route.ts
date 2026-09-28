import { splitWords } from "@/lib/clips/logic";
import { updateSegmentSchema, type Transcript } from "@/lib/clips/schema";
import { HttpError, readJson, userRoute } from "@/lib/server/http";
import { getProject, mutateProject, readTranscript, writeTranscript } from "@/lib/server/store";

type Params = { id: string };

export const GET = userRoute<Params>(async (_req, { userId, params }) => {
  const project = await getProject(userId, params.id);
  const transcript: Transcript = (project.hasTranscript ? await readTranscript(userId, project.id) : null) ?? { segments: [] };
  return Response.json(transcript);
});

/**
 * Fix the words of one caption phrase. Its timing stays the same; measured word times
 * are kept when the number of words is unchanged, otherwise they're estimated again.
 */
export const PATCH = userRoute<Params>(async (req, { userId, params }) => {
  const input = await readJson(req, updateSegmentSchema);
  const project = await mutateProject(userId, params.id, async (p) => {
    const transcript = p.hasTranscript ? await readTranscript(userId, p.id) : null;
    const segment = transcript?.segments[input.index];
    if (!transcript || !segment) throw new HttpError(404, "not_found", "That caption doesn’t exist.");
    const text = input.text.replace(/\s+/g, " ").trim();
    if (text === segment.text) return p;
    const sameCount = splitWords(text).length === splitWords(segment.text).length;
    transcript.segments[input.index] = { ...segment, text, words: sameCount ? segment.words : undefined };
    await writeTranscript(userId, p.id, transcript);
    return { ...p, transcriptRev: p.transcriptRev + 1 };
  });
  return Response.json({ transcriptRev: project.transcriptRev });
});
