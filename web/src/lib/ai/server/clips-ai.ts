import "server-only";
import { z } from "zod";
import { displayText, formatTimecode, normalizeClips, parseTimecode, wordGap, type RawClip } from "@/lib/clips/logic";
import { languageName } from "@/lib/clips/languages";
import { CLIP_LENGTH_RANGE, LIMITS, type ClipLength, type Segment } from "@/lib/clips/schema";
import { generateJson, isMock } from "@/lib/ai/server/gemini";

/* ----------------------------- Transcription ----------------------------- */

/** Seconds as a number, or a "m:ss" / "h:mm:ss" string (models sometimes answer either way). */
const seconds = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const n = typeof v === "number" ? v : parseTimecode(v);
  if (n === null || !Number.isFinite(n)) {
    ctx.addIssue({ code: "custom", message: "time must be seconds" });
    return z.NEVER;
  }
  return n;
});

const transcriptAnswer = z.object({
  language: z.string().max(40).optional(),
  segments: z.array(z.object({ start: seconds, end: seconds, text: z.string().max(2000) })).max(4000),
});

const TRANSCRIPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    language: { type: "string", description: "BCP-47 code of the main spoken language, e.g. en" },
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "number", description: "Seconds from the start of this audio" },
          end: { type: "number", description: "Seconds from the start of this audio" },
          text: { type: "string" },
        },
        required: ["start", "end", "text"],
      },
    },
  },
  required: ["segments"],
};

const TRANSCRIBE_SYSTEM = `You are a precise transcription engine for video captions.
Transcribe speech verbatim in the language spoken. Do not translate, summarise or fix grammar.
Split the speech into short caption phrases of 2 to 12 words that follow natural pauses.
Give each phrase start and end times in seconds from the start of the audio, with one decimal.
Times must increase and must not overlap. Skip music, silence and noises; do not describe them.
If nobody speaks, return an empty list.`;

/** Clean model output: clamp to the chunk, drop empty phrases, fix order and overlaps. */
export function tidySegments(raw: { start: number; end: number; text: string }[], durationSec: number): Segment[] {
  const out: Segment[] = [];
  const sorted = raw
    .map((s) => ({ start: Math.max(0, Math.min(durationSec, s.start)), end: Math.max(0, Math.min(durationSec, s.end)), text: s.text.replace(/\s+/g, " ").trim() }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.start - b.start);
  for (const seg of sorted) {
    const prev = out.at(-1);
    let start = seg.start;
    if (prev && start < prev.end) {
      // Overlap: end the previous phrase where this one starts, if that leaves it any time.
      if (start > prev.start + 0.2) prev.end = start;
      else start = prev.end;
    }
    let end = seg.end;
    if (end <= start) end = Math.min(durationSec, start + Math.max(0.6, seg.text.split(" ").length * 0.3));
    if (end <= start) continue;
    out.push({ start: round(start), end: round(end), text: seg.text.slice(0, 2000) });
  }
  return out;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Transcribe one audio chunk (MP3). Times in the result are relative to the chunk. */
export async function transcribeChunk(audio: Buffer, durationSec: number, signal?: AbortSignal): Promise<{ language?: string; segments: Segment[] }> {
  if (isMock()) return mockTranscribe(durationSec);
  const answer = await generateJson({
    task: "transcribe",
    system: TRANSCRIBE_SYSTEM,
    prompt: `Transcribe this audio. It is ${durationSec.toFixed(1)} seconds long, so every time must be between 0 and ${durationSec.toFixed(1)}.`,
    schema: TRANSCRIPT_JSON_SCHEMA,
    parse: (v) => transcriptAnswer.parse(v),
    media: { mimeType: "audio/mp3", data: audio.toString("base64") },
    temperature: 0,
    thinking: "low",
    signal,
  });
  return { language: answer.language, segments: tidySegments(answer.segments, durationSec) };
}

/* ------------------------------- Highlights ------------------------------- */

const highlightAnswer = z.object({
  clips: z
    .array(
      z.object({
        start: seconds,
        end: seconds,
        title: z.string().max(300),
        reason: z.string().max(600).optional(),
        score: z.number().optional(),
      }),
    )
    .max(80),
});

// Short descriptions: the schema is sent with every request.
const HIGHLIGHT_JSON_SCHEMA = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start: { type: "integer", description: "Number of the clip's first line" },
          end: { type: "integer", description: "Number of the line just after the clip's last line" },
          title: { type: "string", description: "Honest title, at most 60 characters" },
          reason: { type: "string", description: "Why it works as a short, at most 15 words" },
          score: { type: "integer", description: "0 to 100: how well it holds a viewer" },
        },
        required: ["start", "end", "title", "reason", "score"],
      },
    },
  },
  required: ["clips"],
};

const HIGHLIGHT_SYSTEM = `You are a senior short-form video editor. You find the moments in long videos that work as standalone vertical clips for TikTok, YouTube Shorts and Reels.
A good clip opens with a hook in its first 3 seconds (a claim, question, surprise or strong emotion), makes sense without the rest of the video, and ends on a payoff or a complete thought, never mid-sentence.
Prefer funny, surprising, emotional, useful or controversial moments. Avoid intros, outros, sponsor reads and filler.
Titles must be honest to what is said: no invented facts, no clickbait the clip doesn't deliver. Score strictly: 90 and above only for standout moments.
Write titles and reasons in the language of the transcript.`;

/** A transcript line for the model: a few phrases, numbered by the second it starts at. */
export type PromptLine = { n: number; start: number; end: number; text: string };

/**
 * The transcript, compact: caption phrases merged into lines of about 5 to 12 seconds that end
 * at a sentence or a pause, each numbered by the whole second it starts at (unique, rising).
 * Far fewer tokens than a start and end time on every phrase, and the model answers with line
 * numbers that map back to exact phrase times (`clipTimes`).
 */
export function promptLines(segments: Segment[]): PromptLine[] {
  const lines: PromptLine[] = [];
  let cur: PromptLine | null = null;
  for (const [i, seg] of segments.entries()) {
    const text = displayText(seg.text);
    if (!text) continue;
    const prev = segments[i - 1];
    const pause = prev ? seg.start - prev.end : 0;
    const sentenceEnded = Boolean(prev && /[.!?…。！？؟।]["'”’)]*$/.test(prev.text.trim()));
    const long = cur ? seg.end - cur.start : 0;
    if (!cur || (cur.end - cur.start >= 5 && (sentenceEnded || pause >= 0.6)) || long > 12) {
      const n: number = Math.max(Math.floor(seg.start), (lines.at(-1)?.n ?? -1) + 1);
      cur = { n, start: seg.start, end: seg.end, text };
      lines.push(cur);
    } else {
      cur.text += wordGap(cur.text, text) + text;
      cur.end = seg.end;
    }
  }
  return lines;
}

/**
 * Line numbers back to times: the first line's start, and the end of the line before `end`.
 * A clip longer than `fit.maxSec` loses lines from its end (while it stays `fit.minSec` or
 * longer), so it still ends where a line does, not mid-sentence.
 */
export function clipTimes(
  clip: { start: number; end: number },
  lines: PromptLine[],
  durationSec: number,
  fit: { minSec: number; maxSec: number } = { minSec: 0, maxSec: Infinity },
): { start: number; end: number } {
  if (lines.length === 0) return clip;
  // The line a number points at (or the last one before it, for a number between lines).
  const at = (n: number) => {
    let i = 0;
    while (i + 1 < lines.length && lines[i + 1]!.n <= n) i++;
    return i;
  };
  const first = at(clip.start);
  const after = clip.end >= Math.floor(durationSec) ? lines.length : lines[at(clip.end)]!.n === clip.end ? at(clip.end) : at(clip.end) + 1;
  let last = Math.min(Math.max(first, after - 1), lines.length - 1);
  const length = (to: number) => lines[to]!.end - lines[first]!.start;
  while (last > first && length(last) > fit.maxSec && length(last - 1) >= fit.minSec) last--;
  return { start: lines[first]!.start, end: lines[last]!.end };
}

/** How many clips to ask for, from the length of the video. */
export function clipTarget(durationSec: number, clipLength: ClipLength): number {
  const perClip = CLIP_LENGTH_RANGE[clipLength].max;
  return Math.max(1, Math.min(15, Math.round(durationSec / (perClip * 4)) + 2, Math.floor(durationSec / CLIP_LENGTH_RANGE[clipLength].min)));
}

export async function findHighlights(opts: {
  segments: Segment[];
  durationSec: number;
  clipLength: ClipLength;
  title: string;
  /** The transcript's language code, when known. */
  language?: string;
  /** How much video the transcript covers, if not all of it (a followed stream's newest part): sets how many clips to ask for. */
  spanSec?: number;
  avoid?: { start: number; end: number }[];
  signal?: AbortSignal;
}): Promise<RawClip[]> {
  const range = CLIP_LENGTH_RANGE[opts.clipLength];
  const target = clipTarget(opts.spanSec ?? opts.durationSec, opts.clipLength);
  const limits = { durationSec: opts.durationSec, segments: opts.segments, minSec: Math.max(LIMITS.minClipSec, range.min * 0.6), maxSec: Math.min(LIMITS.maxClipSec, range.max * 1.3), max: target };
  if (isMock()) return normalizeClips(mockHighlights(opts.segments, opts.durationSec, opts.clipLength, target, opts.avoid ?? []), limits);

  const lines = promptLines(opts.segments);
  const answer = await generateJson({
    task: `find clips (${lines.length} lines)`,
    system: HIGHLIGHT_SYSTEM,
    prompt: highlightPrompt({ ...opts, lines, target }),
    schema: HIGHLIGHT_JSON_SCHEMA,
    parse: (v) => highlightAnswer.parse(v),
    thinking: "low",
    maxOutputTokens: 16_384,
    signal: opts.signal,
  });
  return normalizeClips(
    answer.clips.map((c) => ({ ...c, ...clipTimes(c, lines, opts.durationSec, { minSec: range.min, maxSec: range.max * 1.1 }), reason: c.reason?.trim().slice(0, 300) || undefined })),
    limits,
  );
}

/**
 * The request: the transcript first and the task last, so asking again about the same video
 * (more clips, another length) starts with the same text, which Gemini caches (cached tokens
 * cost a quarter or less).
 */
export function highlightPrompt(opts: {
  lines: PromptLine[];
  title: string;
  durationSec: number;
  clipLength: ClipLength;
  target: number;
  language?: string;
  avoid?: { start: number; end: number }[];
}): string {
  const range = CLIP_LENGTH_RANGE[opts.clipLength];
  const avoid = (opts.avoid ?? []).map((a) => `${formatTimecode(a.start)}-${formatTimecode(a.end)}`).join(", ");
  return [
    `Transcript of "${opts.title}" (${Math.round(opts.durationSec)} s). Each line starts at the second shown and runs until the next line.`,
    opts.language ? `Spoken language: ${languageName(opts.language)}. It may be lowercase and unpunctuated; read it for meaning.` : "",
    opts.lines.map((l) => `${l.n} ${l.text}`).join("\n"),
    "",
    `Find up to ${opts.target} of the best clips, each ${range.min} to ${range.max} seconds long; fewer if the video has fewer strong moments. Clips must not overlap.`,
    `For each clip, start is the number of its first line and end is the number of the line just after its last line (${Math.floor(opts.durationSec)} for the end of the video). Line numbers are seconds, so end minus start is the clip's length.`,
    avoid ? `The user already has clips at ${avoid}; pick other moments.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/* --------------------------------- Mock --------------------------------- */

const MOCK_LINES = [
  "Okay so here is the thing nobody tells you",
  "I tried this for thirty days straight",
  "and the results honestly surprised me",
  "The first week was the hardest part",
  "but then something clicked",
  "Watch what happens when I do this",
  "That is exactly why it works",
  "Most people quit right before the good part",
  "So here is my advice if you want to start",
  "Keep it simple and show up every day",
];

/** Deterministic phrases every 3 seconds, for demos and tests without a key. */
export function mockTranscribe(durationSec: number): { language: string; segments: Segment[] } {
  const segments: Segment[] = [];
  for (let t = 0.5, i = 0; t + 1 < durationSec; t += 3, i++) {
    segments.push({ start: round(t), end: round(Math.min(durationSec, t + 2.6)), text: MOCK_LINES[i % MOCK_LINES.length]! });
  }
  return { language: "en", segments };
}

function mockHighlights(segments: Segment[], durationSec: number, clipLength: ClipLength, target: number, avoid: { start: number; end: number }[]): RawClip[] {
  const len = Math.min(durationSec, (CLIP_LENGTH_RANGE[clipLength].min + CLIP_LENGTH_RANGE[clipLength].max) / 2);
  const clips: RawClip[] = [];
  const step = Math.max(len, durationSec / target);
  for (let start = 0, i = 0; start + Math.min(len, 3) <= durationSec && clips.length < target; start += step, i++) {
    const end = Math.min(durationSec, start + len);
    if (avoid.some((a) => Math.min(a.end, end) - Math.max(a.start, start) > 0)) continue;
    clips.push({ start, end, title: `Moment ${i + 1}: ${segments[Math.floor(start / 3)]?.text ?? "Highlight"}`, reason: "A clear hook and a complete thought.", score: 90 - i * 7 });
  }
  return clips;
}
