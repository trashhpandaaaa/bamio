import "server-only";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { overlayTitle } from "@/lib/clips/logic";
import { can } from "@/lib/editor/features";
import type { CaptionStyleId, CaptionWord } from "@/lib/editor/model";
import { isAbortError, ProcessError, run } from "@/lib/server/bin";
import { wordsOf } from "@/lib/server/editor-captions";
import { editorLevel } from "@/lib/server/editor-access";
import { HttpError } from "@/lib/server/http";
import { withSourceFile } from "@/lib/server/jobs";
import { storage } from "@/lib/server/storage";
import { getProject, mediaKeys, readTranscript, scratch } from "@/lib/server/store";

/*
 * Opening a Bamio clip in the editor with its captions as words to restyle and fix (Starter),
 * instead of its export with the captions burned in. The clip's part of the source is cut out
 * without re-encoding, from the keyframe at or before its start (so it's quick and exact in
 * picture), and its words come with it, in the cut's own seconds. The editor trims the cut to
 * the clip (`offset`) and frames it the way the clip was framed.
 */

/** What the editor needs to set a clip up: how it was framed and captioned, and where in the cut it starts. */
export type EditorSource = {
  title: string;
  /** Seconds into the cut where the clip starts (the cut starts at a keyframe a little earlier), and how long it is. */
  offset: number;
  duration: number;
  aspect: "9:16" | "1:1" | "16:9";
  /** Horizontal focus of the crop: 0 the left edge, 1 the right. */
  focusX: number;
  fit: "crop" | "fit";
  captions: { on: boolean; style: CaptionStyleId; position: "bottom" | "middle"; words: CaptionWord[]; language: string | null };
  /** The title shown over it, when it has one. */
  overlay: string | null;
};

/** The keyframe at or before `at` in a video: where a cut without re-encoding can start. */
async function keyframeBefore(file: string, at: number): Promise<number> {
  try {
    const { stdout } = await run(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time", "-of", "csv=p=0", "-read_intervals", `${Math.max(0, at - 12).toFixed(3)}%${(at + 0.01).toFixed(3)}`, file],
      { timeoutMs: 60_000, collectStdout: 1024 * 1024 },
    );
    const keys = stdout.split(/\s+/).map(Number).filter((t) => Number.isFinite(t) && t <= at + 1e-3);
    return keys.length > 0 ? Math.max(...keys) : Math.max(0, at - 12);
  } catch {
    return Math.max(0, at - 12);
  }
}

/** Cut a clip out of its project's source for the editor, store it, and say how to set it up. */
export async function editorSource(userId: string, projectId: string, clipId: string): Promise<EditorSource> {
  if (!can(await editorLevel(userId), "captions")) throw new HttpError(402, "plan_required", "Editable captions from your clips come with Starter.");
  const project = await getProject(userId, projectId);
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) throw new HttpError(404, "not_found", "That clip doesn’t exist.");
  const key = mediaKeys(userId, project.id).editorCut(clip.id);
  const work = path.join(scratch(project.id).dir, `editor-${clip.id}`);
  await mkdir(work, { recursive: true });
  const out = path.join(work, "cut.mp4");
  let from = clip.start;
  try {
    await withSourceFile(userId, project, async (file) => {
      from = await keyframeBefore(file, clip.start);
      await run(
        "ffmpeg",
        [
          ...["-hide_banner", "-nostdin", "-y", "-ss", from.toFixed(3), "-i", file, "-t", (clip.end - from + 0.05).toFixed(3)],
          ...["-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", out],
        ],
        { timeoutMs: 10 * 60_000 },
      );
    });
    await storage().publish(key, out, "video/mp4");
  } catch (err) {
    if (isAbortError(err)) throw err;
    console.error("[bamio/editor] cutting a clip for the editor failed:", err instanceof ProcessError ? err.stderrTail.slice(-1000) : err);
    throw new HttpError(422, "cut_failed", "That clip couldn’t be opened in the editor. Try again.");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  const transcript = await readTranscript(userId, project.id);
  // The words inside the clip, in the cut's seconds.
  const words = wordsOf(transcript?.segments ?? [])
    .filter((w) => (w.start + w.end) / 2 >= clip.start && (w.start + w.end) / 2 < clip.end)
    .map((w) => ({ text: w.text, start: Math.max(0, w.start - from), end: Math.max(0, w.end - from) }));
  const edit = clip.edit;
  return {
    title: clip.title.slice(0, 80),
    offset: Math.max(0, clip.start - from),
    duration: clip.end - clip.start,
    aspect: edit.aspect,
    focusX: edit.focusX,
    fit: edit.framing,
    captions: { on: edit.captions, style: edit.captionStyle, position: edit.captionPosition, words, language: transcript?.language ?? null },
    overlay: edit.showTitle ? overlayTitle(clip).slice(0, 240) || null : null,
  };
}

/** The cut made by editorSource, for the browser to read. */
export async function serveEditorCut(req: Request, userId: string, projectId: string, clipId: string): Promise<Response> {
  const project = await getProject(userId, projectId);
  const key = mediaKeys(userId, project.id).editorCut(clipId);
  if (!(await storage().stat(key))) throw new HttpError(404, "not_found", "Open the clip in the editor again.");
  return storage().serve(req, key, { type: "video/mp4" });
}
