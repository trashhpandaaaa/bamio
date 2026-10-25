import { SUBTITLE_FORMATS, type SubtitleFormat } from "@/lib/clips/schema";
import { buildSubtitles, segmentsToCues, SUBTITLE_TYPES } from "@/lib/clips/subtitles";
import { attachmentName, HttpError, userRoute } from "@/lib/server/http";
import { getProject } from "@/lib/server/store";
import { captionsFor } from "@/lib/server/translate";

type Params = { id: string };

/**
 * The whole video's transcript as a file: SRT or WebVTT to use elsewhere, or plain text to
 * read (a paragraph where the speaker pauses). `?lang=` takes one of the project's
 * translations. Free for every account.
 */
export const GET = userRoute<Params>(async (req, { userId, params }) => {
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "srt").toLowerCase();
  if (!SUBTITLE_FORMATS.includes(format as SubtitleFormat)) throw new HttpError(400, "bad_format", "Choose SRT, VTT or TXT.");
  const project = await getProject(userId, params.id);
  const transcript = await captionsFor(userId, project, url.searchParams.get("lang") ?? undefined);
  if (!transcript || transcript.segments.length === 0) throw new HttpError(409, "no_transcript", "This video has no captions yet.");
  const body = buildSubtitles(format as SubtitleFormat, segmentsToCues(transcript.segments));
  return new Response(body, {
    headers: {
      "content-type": SUBTITLE_TYPES[format as SubtitleFormat],
      "content-disposition": `attachment; filename="${attachmentName(project.title, format)}"`,
      "cache-control": "private, no-store",
    },
  });
});
