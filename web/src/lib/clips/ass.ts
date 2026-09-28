import { OUTPUT_SIZE, type CaptionLine } from "@/lib/clips/logic";
import type { Aspect, CaptionPosition, CaptionStyle } from "@/lib/clips/schema";

/*
 * Builds an ASS subtitle file that ffmpeg (libass) burns into the export.
 * Mirrors the in-browser preview: "pop" reveals words one by one with the spoken word
 * in volt; future words are drawn fully transparent so the line never shifts.
 */

/** Family name inside assets/fonts/BricolageGrotesque-ExtraBold.ttf (a static weight-800 instance). */
export const CAPTION_FONT = "Bricolage Grotesque 36pt ExtraBold";
export const CAPTION_FONT_FILE = "BricolageGrotesque-ExtraBold.ttf";

/**
 * Sizes in output pixels, shared with the browser preview. libass sizes a font by its
 * full height (usWinAscent + usWinDescent = 1.56 em for this font), so the CSS em size
 * is ASS size x ASS_EM.
 */
export const ASS_SIZES = { pop: 110, clean: 80, boxed: 76, title: 72 } as const;
export const ASS_OUTLINE = { pop: 7, clean: 3, boxed: 14, title: 18 } as const;
export const ASS_EM = 1000 / 1560;

// ASS colours are &HAABBGGRR.
const WHITE = "&H00FFFFFF";
const BLACK = "&H00000000";
const VOLT = "&H0055EACD";
const INK = "&H00121212";
const SHADOW = "&H80000000";

/** Remove characters that would start ASS override blocks or escapes. */
export function escapeAssText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\\/g, "/").replace(/\{/g, "(").replace(/\}/g, ")");
}

/** Seconds to ASS time H:MM:SS.cc */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360_000);
  const m = Math.floor((cs % 360_000) / 6_000);
  const s = Math.floor((cs % 6_000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

export type AssOptions = {
  lines: CaptionLine[];
  aspect: Aspect;
  style: CaptionStyle;
  position: CaptionPosition;
  durationSec: number;
  title?: string;
};

/** Caption and title placement, as fractions of the output height (shared with the preview). */
export const captionMarginV = (aspect: Aspect, position: CaptionPosition) => (position === "middle" ? 0 : aspect === "9:16" ? 0.2 : 0.1);
export const TITLE_TOP = 0.08;
export const MARGIN_H = 0.08;

export function buildAss({ lines, aspect, style, position, durationSec, title }: AssOptions): string {
  const { width: W, height: H } = OUTPUT_SIZE[aspect];
  const unit = Math.min(W, H) / 1080;
  const px = (n: number) => Math.round(n * unit);
  const alignment = position === "middle" ? 5 : 2;
  const marginV = Math.round(H * captionMarginV(aspect, position));
  const marginH = Math.round(W * MARGIN_H);

  const styles = {
    pop: `Style: Caption,${CAPTION_FONT},${px(ASS_SIZES.pop)},${WHITE},${WHITE},${BLACK},${SHADOW},0,0,0,0,100,100,0,0,1,${px(ASS_OUTLINE.pop)},${px(2)},${alignment},${marginH},${marginH},${marginV},1`,
    clean: `Style: Caption,${CAPTION_FONT},${px(ASS_SIZES.clean)},${WHITE},${WHITE},${BLACK},${SHADOW},0,0,0,0,100,100,0,0,1,${px(ASS_OUTLINE.clean)},${px(3)},${alignment},${marginH},${marginH},${marginV},1`,
    boxed: `Style: Caption,${CAPTION_FONT},${px(ASS_SIZES.boxed)},${WHITE},${WHITE},${INK},${INK},0,0,0,0,100,100,0,0,3,${px(ASS_OUTLINE.boxed)},0,${alignment},${marginH},${marginH},${marginV},1`,
  } satisfies Record<CaptionStyle, string>;
  const titleStyle = `Style: Title,${CAPTION_FONT},${px(ASS_SIZES.title)},${INK},${INK},${VOLT},${VOLT},0,0,0,0,100,100,0,0,3,${px(ASS_OUTLINE.title)},0,8,${marginH},${marginH},${Math.round(H * TITLE_TOP)},1`;

  const events: string[] = [];
  if (title?.trim()) {
    events.push(`Dialogue: 1,${assTime(0)},${assTime(durationSec)},Title,,0,0,0,,${escapeAssText(title.trim())}`);
  }
  for (const line of lines) {
    if (style === "pop") {
      line.words.forEach((word, i) => {
        const end = i + 1 < line.words.length ? line.words[i + 1]!.start : line.end;
        if (end <= word.start) return;
        const text = line.words
          .map((w, j) => {
            const t = escapeAssText(w.text);
            if (j < i) return t;
            if (j === i) return `{\\c${VOLT}&\\fscx110\\fscy110}${t}{\\r}`;
            return `{\\alpha&HFF&}${t}{\\r}`;
          })
          .join(" ");
        events.push(`Dialogue: 0,${assTime(word.start)},${assTime(end)},Caption,,0,0,0,,${text}`);
      });
    } else {
      const text = line.words.map((w) => escapeAssText(w.text)).join(" ");
      events.push(`Dialogue: 0,${assTime(line.start)},${assTime(line.end)},Caption,,0,0,0,,${text}`);
    }
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    styles[style],
    titleStyle,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}
