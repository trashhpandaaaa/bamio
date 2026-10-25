import { outputSize, titleLines, wordGap, type CaptionLine } from "@/lib/clips/logic";
import type { Aspect, CaptionLook, CaptionPosition, CaptionStyle, ClipQuality } from "@/lib/clips/schema";

/*
 * Builds an ASS subtitle file that ffmpeg (libass) burns into the export.
 * Mirrors the in-browser preview: "pop" reveals words one by one with the spoken word
 * in volt; future words are drawn fully transparent so the line never shifts.
 *
 * A clip may carry a look of its own (captionLookSchema: colours, size, outline, capitals,
 * and picking out the loud words). Every part of it is optional, and the defaults here are
 * exactly what the three styles drew before it existed.
 */

/** Family name inside assets/fonts/BricolageGrotesque-ExtraBold.ttf (a static weight-800 instance). */
export const CAPTION_FONT = "Bricolage Grotesque 36pt ExtraBold";
export const CAPTION_FONT_FILE = "BricolageGrotesque-ExtraBold.ttf";

/**
 * Sizes in output pixels at 1080p, shared with the browser preview. libass sizes a font by its
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

/** The colours the styles use by default, as the pickers show them. */
export const CAPTION_COLOR_DEFAULT = "#FFFFFF";
export const CAPTION_HIGHLIGHT_DEFAULT = "#CDEA55";

/** "#RRGGBB" to ASS's &H00BBGGRR. Anything else falls back to `fallback`. */
export function hexToAss(hex: string | undefined, fallback: string): string {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex ?? "");
  if (!m) return fallback;
  return `&H00${m[3]!.toUpperCase()}${m[2]!.toUpperCase()}${m[1]!.toUpperCase()}`;
}

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
  /** 1080p unless given: everything is measured against the frame's short side, so 4K just scales. */
  quality?: ClipQuality;
  /** The clip's own caption look, where it has one. */
  look?: CaptionLook;
  /**
   * Escapes text drawn at font size `size` (output pixels); the server's version also
   * switches to the right font for other scripts (lib/server/caption-fonts.ts).
   */
  markup?: (text: string, size: number) => string;
};

/** Caption and title placement, as fractions of the output height (shared with the preview). */
export const captionMarginV = (aspect: Aspect, position: CaptionPosition) => (position === "middle" ? 0 : aspect === "9:16" ? 0.2 : 0.1);
export const TITLE_TOP = 0.08;
export const MARGIN_H = 0.08;

/** A look's size and outline as a share of the style's own (1 = unchanged). */
export const lookScale = (look: CaptionLook | undefined) => ({ size: (look?.sizePct ?? 100) / 100, outline: (look?.outlinePct ?? 100) / 100 });

export function buildAss({ lines, aspect, style, position, durationSec, title, quality = "1080p", look, markup = (t) => escapeAssText(t) }: AssOptions): string {
  const { width: W, height: H } = outputSize(aspect, quality);
  const unit = Math.min(W, H) / 1080;
  const px = (n: number) => Math.round(n * unit);
  const scale = lookScale(look);
  const sizeOf = (s: CaptionStyle) => Math.max(1, px(ASS_SIZES[s] * scale.size));
  const outlineOf = (s: CaptionStyle) => Math.max(0, px(ASS_OUTLINE[s] * scale.outline));
  const captionSize = sizeOf(style);
  const textColor = hexToAss(look?.color, WHITE);
  const highlight = hexToAss(look?.highlight, VOLT);
  const caps = (text: string) => (look?.uppercase ? text.toLocaleUpperCase() : text);
  /** Words joined as they read (no spaces in scripts written without them). */
  const join = (texts: string[], words: { text: string }[]) => texts.reduce((acc, t, i) => (i === 0 ? t : acc + wordGap(words[i - 1]!.text, words[i]!.text) + t), "");
  const alignment = position === "middle" ? 5 : 2;
  const marginV = Math.round(H * captionMarginV(aspect, position));
  const marginH = Math.round(W * MARGIN_H);

  const styles = {
    pop: `Style: Caption,${CAPTION_FONT},${sizeOf("pop")},${textColor},${textColor},${BLACK},${SHADOW},0,0,0,0,100,100,0,0,1,${outlineOf("pop")},${px(2)},${alignment},${marginH},${marginH},${marginV},1`,
    clean: `Style: Caption,${CAPTION_FONT},${sizeOf("clean")},${textColor},${textColor},${BLACK},${SHADOW},0,0,0,0,100,100,0,0,1,${outlineOf("clean")},${px(3)},${alignment},${marginH},${marginH},${marginV},1`,
    boxed: `Style: Caption,${CAPTION_FONT},${sizeOf("boxed")},${textColor},${textColor},${INK},${INK},0,0,0,0,100,100,0,0,3,${outlineOf("boxed")},0,${alignment},${marginH},${marginH},${marginV},1`,
  } satisfies Record<CaptionStyle, string>;
  const titleStyle = `Style: Title,${CAPTION_FONT},${px(ASS_SIZES.title)},${INK},${INK},${VOLT},${VOLT},0,0,0,0,100,100,0,0,3,${px(ASS_OUTLINE.title)},0,8,${marginH},${marginH},${Math.round(H * TITLE_TOP)},1`;

  /** The loud words keep the highlight colour, where the look asks for it. */
  const loudly = (text: string, word: { loud?: boolean }) => (look?.loudWords && word.loud ? `{\\c${highlight}&}${text}{\\r}` : text);

  const events: string[] = [];
  if (title?.trim()) {
    const text = titleLines(title.trim())
      .map((l) => markup(l, px(ASS_SIZES.title)))
      .join("\\N");
    events.push(`Dialogue: 1,${assTime(0)},${assTime(durationSec)},Title,,0,0,0,,${text}`);
  }
  for (const line of lines) {
    if (style === "pop") {
      line.words.forEach((word, i) => {
        const end = i + 1 < line.words.length ? line.words[i + 1]!.start : line.end;
        if (end <= word.start) return;
        const texts = line.words.map((w, j) => {
          const t = markup(caps(w.text), captionSize);
          // Said already: its own colour, or the highlight where the look keeps the loud words marked.
          if (j < i) return loudly(t, w);
          if (j === i) return `{\\c${highlight}&\\fscx110\\fscy110}${t}{\\r}`;
          return `{\\alpha&HFF&}${t}{\\r}`;
        });
        events.push(`Dialogue: 0,${assTime(word.start)},${assTime(end)},Caption,,0,0,0,,${join(texts, line.words)}`);
      });
    } else {
      const text = join(
        line.words.map((w) => loudly(markup(caps(w.text), captionSize), w)),
        line.words,
      );
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
