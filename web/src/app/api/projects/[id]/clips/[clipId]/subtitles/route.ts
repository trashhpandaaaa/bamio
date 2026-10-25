import { captionLines } from "@/lib/clips/logic";
import { SUBTITLE_FORMATS, type SubtitleFormat } from "@/lib/clips/schema";
import { buildSubtitles, linesToCues, SUBTITLE_TYPES } from "@/lib/clips/subtitles";
import { attachmentName, HttpError, userRoute } from "@/lib/server/http";
import { getProject } from "@/lib/server/store";
import { captionsFor } from "@/lib/server/translate";

type Params = { id: string; clipId: string };

/**
 * A clip's captions as a subtitle file: SRT, WebVTT or plain text, timed from the clip's own
 * start so it lines up with the exported video. Free for every account: the words were
 * measured when the video was transcribed, and the file costs nothing to make.
 *
 * `?lang=` takes a translation the project has (Pro made it); without it, the spoken language.
 */
export const GET = userRoute<Params>(async (req, { userId, params }) => {
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "srt").toLowerCase();
  if (!SUBTITLE_FORMATS.includes(format as SubtitleFormat)) throw new HttpError(400, "bad_format", "Choose SRT, VTT or TXT.");
  const project = await getProject(userId, params.id);
  const clip = project.clips.find((c) => c.id === params.clipId);
  if (!clip) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
  const language = url.searchParams.get("lang") ?? clip.edit.captionLanguage;
  const transcript = await captionsFor(userId, project, language ?? undefined);
  if (!transcript || transcript.segments.length === 0) throw new HttpError(409, "no_transcript", "This video has no captions yet.");
  // The same lines the export burns in, so the file and the picture agree.
  const lines = captionLines(transcript.segments, clip.start, clip.end, clip.edit.captionStyle);
  const body = buildSubtitles(format as SubtitleFormat, linesToCues(lines));
  return new Response(body, {
    headers: {
      "content-type": SUBTITLE_TYPES[format as SubtitleFormat],
      "content-disposition": `attachment; filename="${attachmentName(clip.title, format)}"`,
      "cache-control": "private, no-store",
    },
  });
});
