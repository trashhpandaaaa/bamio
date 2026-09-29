import "server-only";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAutoLanguage, languageName } from "@/lib/clips/languages";
import { transcriptSchema, type Transcript } from "@/lib/clips/schema";
import { isAbortError, ProcessError, run, runNode } from "@/lib/server/bin";
import { HttpError } from "@/lib/server/http";

/*
 * On-device transcription with word timing, in any language: workers/transcribe.mjs detects
 * the language (unless given), then runs Silero VAD and the language's model (NVIDIA
 * Parakeet or Meta Omnilingual ASR, via sherpa-onnx) in its own Node process. Word times
 * come from the audio itself, so captions line up with speech however long the video is.
 */

/** Off with BAMIO_LOCAL_TRANSCRIBE=0 (then Gemini transcribes, with approximate timing). */
export const localTranscriptionOn = () => process.env.BAMIO_LOCAL_TRANSCRIBE !== "0";

// Runtime paths, not part of the build: tell Turbopack not to trace them.
const workerPath = () => path.join(/*turbopackIgnore: true*/ process.cwd(), "workers", "transcribe.mjs");
export const modelsDir = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.BAMIO_MODELS_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".models"));

/** Threads for the model: half the cores (at most 4), so exports and the web server keep running. */
const threads = () => Math.max(1, Math.min(4, Math.floor(os.cpus().length / 2)));

/**
 * Transcribe a video's audio. `workDir` is scratch space (removed afterwards).
 * Progress messages cover the one-time model download too.
 */
export async function transcribeLocal(
  source: string,
  workDir: string,
  language: string | undefined,
  signal: AbortSignal,
  onProgress: (value: number, message: string) => void,
): Promise<Transcript> {
  if (!existsSync(workerPath())) throw new HttpError(500, "no_worker", "The transcription worker is missing.");
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });
  try {
    // Mono 16 kHz audio, padded or trimmed so sample 0 is the video's time 0 and gaps stay gaps.
    const pcm = path.join(workDir, "audio.s16");
    await run(
      "ffmpeg",
      ["-hide_banner", "-nostdin", "-y", "-i", source, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-af", "aresample=async=1:first_pts=0", "-f", "s16le", pcm],
      { signal, timeoutMs: 60 * 60 * 1000 },
    );
    const job = path.join(workDir, "job.json");
    const out = path.join(workDir, "out.json");
    await writeFile(job, JSON.stringify({ pcm, modelsDir: modelsDir(), language: isAutoLanguage(language) ? "auto" : language, model: process.env.BAMIO_SPEECH_MODEL, threads: threads(), out }));
    let spoken = isAutoLanguage(language) ? "" : languageName(language);
    onProgress(0, spoken ? `Transcribing ${spoken} on this device` : "Detecting the language");
    await runNode(workerPath(), [job], {
      signal,
      timeoutMs: 6 * 60 * 60 * 1000,
      onStdoutLine: (line) => {
        const lang = /^LANGUAGE (\S+)/.exec(line);
        if (lang) {
          spoken = languageName(lang[1]);
          onProgress(0, `Transcribing ${spoken} on this device`);
          return;
        }
        const m = /^(DOWNLOAD|PROGRESS) ([\d.]+)/.exec(line);
        if (!m) return;
        if (m[1] === "DOWNLOAD") onProgress(Number(m[2]), `Downloading the speech model${spoken ? ` for ${spoken}` : ""} (first time only)`);
        else onProgress(Number(m[2]), `Transcribing ${spoken || "the speech"} on this device`);
      },
    });
    return transcriptSchema.parse(JSON.parse(await readFile(out, "utf8")));
  } catch (err) {
    if (isAbortError(err) || signal.aborted) throw err;
    if (err instanceof HttpError) throw err;
    const detail = err instanceof ProcessError ? err.stderrTail.slice(-1500) : err;
    console.error("[bamio/transcribe] local transcription failed:", detail);
    const tail = err instanceof ProcessError ? err.stderrTail : "";
    const download = /Download failed|Checksum|unpack/i.test(tail);
    // Windows Smart App Control sometimes refuses the speech engine's (unsigned) DLLs for a while.
    const blocked = /Application Control policy|Could not find sherpa-onnx-node/i.test(tail);
    throw new HttpError(
      500,
      "transcribe_failed",
      download
        ? "The speech model couldn’t be downloaded. Check the internet connection, or run npm run setup:media in web/."
        : blocked
          ? "Windows (Smart App Control) blocked the on-device speech engine. It usually allows it again after a while; try again later."
          : "Transcription failed on this device. Try again.",
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
