import { Anton, Bebas_Neue, Montserrat, Pacifico, Permanent_Marker, Space_Mono } from "next/font/google";
import type { Face, Fonts } from "@/lib/editor/compose";
import { FONT_IDS, type FontId } from "@/lib/editor/model";

/*
 * The editor's typefaces for text and captions (TEXT_FONTS in model.ts). next/font fetches them
 * from Google Fonts when the site is built and Bamio serves them itself, so a visitor's browser
 * never asks Google for them. A canvas can only draw a face that's loaded: loadFonts asks for
 * the ones an edit uses before it's drawn or exported. Latin letters only: other scripts are
 * drawn in the device's own font for them.
 */

const montserrat = Montserrat({ subsets: ["latin", "latin-ext"], weight: ["800"], display: "swap" });
const anton = Anton({ subsets: ["latin", "latin-ext"], weight: ["400"], display: "swap" });
const bebas = Bebas_Neue({ subsets: ["latin", "latin-ext"], weight: ["400"], display: "swap" });
const marker = Permanent_Marker({ subsets: ["latin"], weight: ["400"], display: "swap" });
const pacifico = Pacifico({ subsets: ["latin", "latin-ext"], weight: ["400"], display: "swap" });
const mono = Space_Mono({ subsets: ["latin", "latin-ext"], weight: ["700"], display: "swap" });

/** The page's own face (Bricolage), as the layout loaded it. */
function pageFamily(): string {
  const family = typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue("--font-bricolage").trim();
  return family ? `${family}, system-ui, sans-serif` : "system-ui, sans-serif";
}

/** Every typeface the editor offers, as the canvas names it. */
export function editorFonts(): Fonts {
  const face = (family: string, weight: number): Face => ({ family, weight });
  return {
    bricolage: face(pageFamily(), 800),
    montserrat: face(montserrat.style.fontFamily, 800),
    anton: face(anton.style.fontFamily, 400),
    bebas: face(bebas.style.fontFamily, 400),
    marker: face(marker.style.fontFamily, 400),
    pacifico: face(pacifico.style.fontFamily, 400),
    mono: face(mono.style.fontFamily, 700),
  };
}

/** Load typefaces before they're drawn (all of them, or `ids`). Resolves even when one can't load: the canvas then uses another. */
export async function loadFonts(fonts: Fonts, ids: readonly FontId[] = FONT_IDS): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all(
    ids.map((id) => {
      const face = fonts[id];
      return face ? document.fonts.load(`${face.weight} 40px ${face.family}`).catch(() => undefined) : undefined;
    }),
  );
}

/** The typefaces an edit uses (for loading before an export). */
export function fontsUsed(edit: { texts: { font?: FontId }[]; captions?: { on: boolean; font: FontId } }): FontId[] {
  const used = new Set<FontId>(["bricolage"]);
  for (const text of edit.texts) if (text.font) used.add(text.font);
  if (edit.captions?.on) used.add(edit.captions.font);
  return [...used];
}
