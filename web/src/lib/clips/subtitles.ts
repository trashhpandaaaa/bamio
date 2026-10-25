import { joinWords, splitWords, type CaptionLine } from "@/lib/clips/logic";
import type { Segment, SubtitleFormat } from "@/lib/clips/schema";

/*
 * Subtitle files from what Bamio already measured: a time for every word, in any language.
 * SRT and WebVTT for a clip (its caption lines, timed from the clip's own start) or for a
 * whole video (its transcript phrases), and plain text for reading.
 *
 * Free for every account: the transcript is the user's own, and a file of it costs nothing
 * to make. Nothing here touches the network or the disk, so it is all unit-tested.
 */

/** SRT wants a comma before the milliseconds, WebVTT a full stop. */
function stamp(seconds: number, sep: "," | "."): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
}

/** A cue's text: one line, with the spaces the language itself uses (none in Chinese, Japanese, Thai...). */
const cueText = (words: { text: string }[]) => joinWords(words.map((w) => w.text));

type Cue = { start: number; end: number; text: string };

/** Cues in order, each at least a moment long and never starting before the one before ends. */
function tidy(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    if (!cue.text.trim()) continue;
    const start = Math.max(0, out.length > 0 ? Math.max(cue.start, out.at(-1)!.end) : cue.start);
    const end = Math.max(start + 0.04, cue.end);
    out.push({ start, end, text: cue.text.trim() });
  }
  return out;
}

export const linesToCues = (lines: CaptionLine[]): Cue[] => tidy(lines.map((l) => ({ start: l.start, end: l.end, text: cueText(l.words) })));

/** A whole video's phrases as cues, from `start`, so a clip's own file can be made from a range too. */
export const segmentsToCues = (segments: Segment[], from = 0, to = Infinity): Cue[] =>
  tidy(
    segments
      .filter((s) => s.end > from && s.start < to && s.end > s.start)
      .map((s) => ({ start: Math.max(0, s.start - from), end: Math.min(to, s.end) - from, text: cueText(splitWords(s.text).map((text) => ({ text }))) })),
  );

export function buildSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${stamp(c.start, ",")} --> ${stamp(c.end, ",")}\n${c.text}\n`).join("\n");
}

export function buildVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, ".")} --> ${stamp(c.end, ".")}\n${c.text}\n`).join("\n")}`;
}

/** Plain text to read: a blank line where the speaker pauses for more than two seconds. */
export function buildTxt(cues: Cue[]): string {
  const paragraphs: string[][] = [];
  let last = -Infinity;
  for (const cue of cues) {
    if (cue.start - last > 2 || paragraphs.length === 0) paragraphs.push([]);
    paragraphs.at(-1)!.push(cue.text);
    last = cue.end;
  }
  return `${paragraphs.map((p) => p.join(" ")).join("\n\n")}\n`;
}

export const SUBTITLE_TYPES: Record<SubtitleFormat, string> = {
  srt: "application/x-subrip; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

export function buildSubtitles(format: SubtitleFormat, cues: Cue[]): string {
  if (format === "srt") return buildSrt(cues);
  if (format === "vtt") return buildVtt(cues);
  return buildTxt(cues);
}
