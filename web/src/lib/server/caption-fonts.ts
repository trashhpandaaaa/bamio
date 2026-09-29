import "server-only";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { CAPTION_FONT, escapeAssText } from "@/lib/clips/ass";
import { HttpError } from "@/lib/server/http";
import { modelsDir } from "@/lib/server/transcribe";
import table from "./caption-fonts.json";

/*
 * Caption fonts for every script. Bricolage Grotesque (bundled) draws Latin; each other
 * script falls back to a Noto font (OFL), downloaded once into <models>/fonts and checked
 * against a pinned SHA-256. The export (libass) and the preview (the browser) pick the
 * same font for every character: the first font in captionFontOrder() that has it,
 * using the coverage recorded in caption-fonts.json (made from each font's cmap).
 */

export type CaptionFont = {
  id: string;
  file: string;
  /** The family name libass matches (name ID 1). */
  ass: string;
  /** usWinAscent + usWinDescent in ems: libass sizes a font by this height. */
  height: number;
  /** null: bundled in assets/fonts. */
  url: string | null;
  bytes: number;
  sha256: string;
  ranges: string;
};

const FONTS = table.fonts as CaptionFont[];
const BRICOLAGE = FONTS[0]!;
const CJK = ["NotoSansSC", "NotoSansTC", "NotoSansJP", "NotoSansKR"];

/** Parsed coverage of each font: sorted [start, end] pairs. */
const coverage = new Map<string, number[][]>();
function rangesOf(font: CaptionFont): number[][] {
  let r = coverage.get(font.id);
  if (!r) {
    r = font.ranges.split(",").map((part) => {
      const [a, b] = part.split("-");
      return [Number.parseInt(a!, 16), Number.parseInt(b ?? a!, 16)];
    });
    coverage.set(font.id, r);
  }
  return r;
}

export function covers(font: CaptionFont, codePoint: number): boolean {
  const r = rangesOf(font);
  let lo = 0;
  let hi = r.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = r[mid]!;
    if (codePoint < a!) hi = mid - 1;
    else if (codePoint > b!) lo = mid + 1;
    else return true;
  }
  return false;
}

/**
 * Fonts in the order they're tried. Chinese characters look different in Japanese,
 * Korean and Traditional Chinese, so the CJK fonts come in the order that suits the language.
 */
export function captionFontOrder(language?: string): CaptionFont[] {
  const lang = (language ?? "").toLowerCase();
  const cjk =
    lang.startsWith("ja") ? ["NotoSansJP", "NotoSansSC", "NotoSansTC", "NotoSansKR"]
    : lang.startsWith("ko") ? ["NotoSansKR", "NotoSansSC", "NotoSansTC", "NotoSansJP"]
    : /^(zh-(hant|tw|hk|mo)|yue)/.test(lang) ? ["NotoSansTC", "NotoSansSC", "NotoSansJP", "NotoSansKR"]
    : CJK;
  return [...FONTS.filter((f) => !CJK.includes(f.id)), ...cjk.map((id) => FONTS.find((f) => f.id === id)!)];
}

/** Characters that belong with the one before them: combining marks, joiners, variation selectors, spaces. */
const ATTACHES = /^[\p{M}‌‍︀-️\s]$/u;

/** Text split into runs, each drawn with one font (null: no caption font has it). */
export function fontRuns(text: string, language?: string): { font: CaptionFont | null; text: string }[] {
  const order = captionFontOrder(language);
  const runs: { font: CaptionFont | null; text: string }[] = [];
  for (const ch of text) {
    const last = runs.at(-1);
    const font = last && ATTACHES.test(ch) ? last.font : (order.find((f) => covers(f, ch.codePointAt(0)!)) ?? null);
    if (last && last.font === font) last.text += ch;
    else runs.push({ font, text: ch });
  }
  return runs;
}

/**
 * ASS text for `text` at font size `size`: runs in other scripts switch font, and their
 * size is adjusted so an em is as big as Bricolage's (libass sizes each font by its own height).
 */
export function assMarkup(text: string, size: number, language?: string): string {
  return fontRuns(text, language)
    .map(({ font, text: run }) => {
      const escaped = escapeAssText(run);
      if (!font || font === BRICOLAGE) return escaped;
      const fs = Math.round(((size * font.height) / BRICOLAGE.height) * 10) / 10;
      return `{\\fn${font.ass}\\fs${fs}}${escaped}{\\fn${CAPTION_FONT}\\fs${size}}`;
    })
    .join("");
}

/** The fonts some texts need, besides Bricolage. */
export function fontsNeeded(texts: string[], language?: string): CaptionFont[] {
  const found = new Set<CaptionFont>();
  for (const t of texts) for (const run of fontRuns(t, language)) if (run.font && run.font !== BRICOLAGE) found.add(run.font);
  return [...found];
}

// Runtime paths, not part of the build.
export const fontsDir = () => path.join(/*turbopackIgnore: true*/ modelsDir(), "fonts");
const bundledFont = (file: string) => path.join(/*turbopackIgnore: true*/ process.cwd(), "assets", "fonts", file);

export function fontByFile(file: string): CaptionFont | undefined {
  return FONTS.find((f) => f.file === file);
}

const downloads = new Map<string, Promise<string>>();

/** The font file on disk, downloading and checking it the first time. */
export function ensureFont(font: CaptionFont): Promise<string> {
  if (!font.url) return Promise.resolve(bundledFont(font.file));
  const target = path.join(/*turbopackIgnore: true*/ fontsDir(), font.file);
  if (existsSync(target)) return Promise.resolve(target);
  let pending = downloads.get(font.id);
  if (!pending) {
    pending = (async () => {
      const res = await fetch(font.url!, { signal: AbortSignal.timeout(120_000) }).catch(() => null);
      if (!res?.ok) throw new HttpError(502, "font_download", `The caption font for this language (${font.ass}) couldn’t be downloaded. Check the internet connection, or run npm run setup:media.`);
      const data = Buffer.from(await res.arrayBuffer());
      if (createHash("sha256").update(data).digest("hex") !== font.sha256) throw new HttpError(502, "font_checksum", `The caption font ${font.file} didn’t match its checksum.`);
      await mkdir(fontsDir(), { recursive: true });
      const tmp = `${target}.download`;
      await writeFile(tmp, data);
      await rename(tmp, target);
      return target;
    })().finally(() => downloads.delete(font.id));
    downloads.set(font.id, pending);
  }
  return pending;
}

/**
 * @font-face rules for the preview: one family, "Bamio Caption", made of every font with
 * its exact coverage as unicode-range. For overlapping ranges the browser uses the face
 * declared last, so they're declared lowest priority first. Only the fonts a caption
 * actually needs get downloaded.
 */
export function captionFontCss(language?: string): string {
  const faces = [...captionFontOrder(language)].reverse().map((f) => {
    const range = f.ranges
      .split(",")
      .map((r) => `U+${r}`)
      .join(",");
    return `@font-face{font-family:"Bamio Caption";font-weight:800;font-display:block;src:url("/api/fonts/${f.file}") format("${f.file.endsWith(".otf") ? "opentype" : "truetype"}");unicode-range:${range}}`;
  });
  return faces.join("\n");
}
