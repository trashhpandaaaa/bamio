import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";
import { TOKENS } from "@/lib/brand-tokens";

/*
 * Link previews (Open Graph and X cards, 1200 x 630): the wordmark, a headline in Bamio's voice
 * with its volt highlight, three facts, and a 9:16 frame with a caption, on paper. Rendered by
 * Satori at build time from each route's opengraph-image.tsx. Colours come from TOKENS, since
 * Satori can't read CSS variables.
 */

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_TYPE = "image/png";

const P = TOKENS.paper;
const INK = TOKENS.brand["--ink"];
const VOLT = TOKENS.brand["--volt"];

/** The site's highlight (.hl): a volt band from 12% to 92% of the line. */
const HL = `linear-gradient(transparent 12%, ${VOLT} 12%, ${VOLT} 92%, transparent 92%)`;
const words = (text: string, hl: boolean) => text.split(" ").filter(Boolean).map((word) => ({ word, hl }));

const font = () => readFile(path.join(/*turbopackIgnore: true*/ process.cwd(), "assets/fonts/BricolageGrotesque-ExtraBold.ttf"));

/** `headline`: before the highlight, the highlight, after it. `caption`: the words in the 9:16 frame. */
export async function renderOg(opts: { headline: [string, string, string?]; facts: [string, string, string]; caption: string }) {
  const [before, mark, after] = opts.headline;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: P["--bg"], color: INK, fontFamily: "Bricolage", padding: "64px 72px" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, paddingRight: 48 }}>
          {/* The wordmark: lowercase bamio, its i-dot a 9:16 frame tilted 12 degrees. */}
          <div style={{ display: "flex", alignItems: "flex-end", fontSize: 54, letterSpacing: -2.6, lineHeight: 1 }}>
            <span>bam</span>
            <span style={{ display: "flex", position: "relative" }}>
              ı
              <span style={{ position: "absolute", left: 4, top: -5, width: 8, height: 14, borderRadius: 3, background: INK, transform: "rotate(12deg)" }} />
            </span>
            <span>o</span>
          </div>
          {/* Word by word, so the highlight follows each line when it wraps, like .hl on the site (padding stands in for the spaces). */}
          <div style={{ display: "flex", flexWrap: "wrap", fontSize: 76, lineHeight: 1.04, letterSpacing: -3.4, maxWidth: 730, marginLeft: -9 }}>
            {words(before, false)
              .concat(words(mark, true), words(after ?? "", false))
              .map(({ word, hl }, i) => (
                <span key={i} style={hl ? { padding: "0 9px", backgroundImage: HL } : { padding: "0 9px" }}>
                  {word}
                </span>
              ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 20, lineHeight: 1 }}>
            {opts.facts.map((fact) => (
              <span
                key={fact}
                style={{
                  display: "flex",
                  alignItems: "center",
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  height: 44,
                  padding: "0 16px",
                  borderRadius: 999,
                  border: `2px solid ${P["--line"]}`,
                  background: P["--surface"],
                  color: P["--text-secondary"],
                }}
              >
                {fact}
              </span>
            ))}
          </div>
        </div>
        {/* A vertical clip with a caption, like Bamio's exports. */}
        <div style={{ display: "flex", width: 280, height: 500, alignSelf: "center", borderRadius: 28, background: INK, transform: "rotate(4deg)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 300, background: `linear-gradient(160deg, ${TOKENS.night["--surface"]}, ${INK})` }} />
          {/* The caption, a word at a time; the second word is the one being said, highlighted as in the Pop style. (Satori can't take undefined style values.) */}
          <div
            style={{
              position: "absolute",
              left: 22,
              right: 22,
              bottom: 92,
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              rowGap: 6,
              fontSize: 34,
              lineHeight: 1.15,
              color: TOKENS.night["--text"],
            }}
          >
            {opts.caption.split(" ").map((word, i) => (
              <span key={i} style={i === 1 ? { color: INK, background: VOLT, padding: "0 6px", borderRadius: 6, margin: "0 5px" } : { margin: "0 5px" }}>
                {word}
              </span>
            ))}
          </div>
          <div style={{ position: "absolute", left: 22, right: 22, bottom: 40, height: 8, borderRadius: 999, background: TOKENS.night["--line"], display: "flex" }}>
            <div style={{ width: "62%", borderRadius: 999, background: VOLT }} />
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: [{ name: "Bricolage", data: await font(), weight: 800, style: "normal" }] },
  );
}
