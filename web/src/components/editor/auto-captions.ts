import { api, ApiError } from "@/lib/clips/api";
import type { Asset } from "@/lib/editor/assets";
import { monoSamples } from "@/lib/editor/assets";
import { PIECE_GAP, soundPlan, wordsToMedia } from "@/lib/editor/captions";
import type { CaptionWord, Edit } from "@/lib/editor/model";
import { wavOfSamples } from "@/lib/editor/wav";

/*
 * Auto captions (Pro): the one time the editor sends anything to Bamio, and only when asked.
 * The sound of the parts the edit uses (not the picture, not the rest of the files) is put
 * together here as one small WAV, transcribed by Bamio's transcriber, and the words come back
 * in each file's own seconds. The server deletes the sound once it's transcribed.
 */

const RATE = 16_000;
/** The most sound sent at once, in seconds (the server's CAPTION_LIMITS). */
export const MAX_CAPTION_SEC = 20 * 60;

export class CaptionError extends Error {}

export async function makeCaptions(
  edit: Edit,
  assets: ReadonlyMap<string, Asset>,
  language: string,
  onProgress: (stage: "reading" | "sending" | "transcribing", done: number) => void,
  signal: AbortSignal,
): Promise<{ words: Record<string, CaptionWord[]>; language: string | null }> {
  const plan = soundPlan(edit, (id) => Boolean(assets.get(id)?.audioTrack));
  if (plan.pieces.length === 0) throw new CaptionError("Nothing in this edit has sound to caption.");
  if (plan.total > MAX_CAPTION_SEC + 1) throw new CaptionError(`Captions can be made for up to ${MAX_CAPTION_SEC / 60} minutes of sound at once. Trim the edit first.`);

  // The pieces one after another, a short silence between them.
  const sound = new Float32Array(Math.ceil((plan.total + PIECE_GAP) * RATE));
  let read = 0;
  for (const piece of plan.pieces) {
    if (signal.aborted) throw new DOMException("Stopped.", "AbortError");
    const asset = assets.get(piece.mediaId);
    const samples = asset ? await monoSamples(asset, piece.start, piece.end, RATE) : null;
    if (samples) sound.set(samples.subarray(0, Math.max(0, sound.length - Math.round(piece.at * RATE))), Math.round(piece.at * RATE));
    read += piece.end - piece.start;
    onProgress("reading", read / Math.max(1, plan.total));
  }

  onProgress("sending", 0);
  let id: string;
  try {
    ({ id } = await api.editor.captions(wavOfSamples(sound, RATE), language, signal));
  } catch (err) {
    if (err instanceof ApiError) throw new CaptionError(err.message);
    throw err;
  }

  // Transcription takes a while: ask every couple of seconds.
  for (;;) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 2000);
      signal.addEventListener("abort", () => (clearTimeout(timer), reject(new DOMException("Stopped.", "AbortError"))), { once: true });
    });
    let job;
    try {
      job = await api.editor.captionJob(id, signal);
    } catch (err) {
      if (err instanceof ApiError && err.status !== 0) throw new CaptionError(err.message);
      if (err instanceof ApiError) continue;
      throw err;
    }
    if (job.status === "failed") throw new CaptionError(job.error ?? "The captions couldn’t be made. Try again.");
    if (job.status === "ready") return { words: wordsToMedia(plan.pieces, job.words ?? []), language: job.language };
    onProgress("transcribing", job.progress ?? 0);
  }
}
