import { Fragment } from "react";
import { ASS_EM, ASS_OUTLINE, ASS_SIZES, captionMarginV, MARGIN_H, TITLE_TOP } from "@/lib/clips/ass";
import { joinWords, wordGap } from "@/lib/clips/logic";
import type { CaptionPosition, CaptionStyle } from "@/lib/clips/schema";
import styles from "./demo-caption.module.css";

/*
 * Captions for the landing page's demos, drawn with the same spec as the clip editor's
 * preview and the export (lib/clips/ass.ts): sizes, outline, shadow and margins in units of
 * a 1080-wide frame. Place inside a 9:16 box with container-type: inline-size.
 */

const u = (n: number) => `calc(${n} * 100cqw / 1080)`;

/**
 * One caption line. "pop" shows the words spoken so far, the current one (`active`) in volt;
 * the others show the whole line. `active` -1 shows the line as it looks when finished.
 */
export function DemoCaption({
  words,
  active,
  captionStyle,
  position = "bottom",
  lang,
}: {
  words: string[];
  active: number;
  captionStyle: CaptionStyle;
  position?: CaptionPosition;
  lang?: string;
}) {
  const place: React.CSSProperties =
    position === "middle" ? { top: "50%", transform: "translateY(-50%)" } : { bottom: `${captionMarginV("9:16", position) * 100}%` };
  const last = active < 0 ? words.length - 1 : active;
  return (
    <p
      className={styles.caption}
      data-style={captionStyle}
      lang={lang}
      dir="auto"
      aria-hidden="true"
      style={{
        ...place,
        left: `${MARGIN_H * 100}%`,
        right: `${MARGIN_H * 100}%`,
        fontSize: u(ASS_SIZES[captionStyle] * ASS_EM),
        ["--stroke" as string]: u(ASS_OUTLINE[captionStyle] * 2),
        ["--shadow" as string]: u(captionStyle === "clean" ? 3 : 2),
        ["--pad" as string]: u(ASS_OUTLINE.boxed),
      }}
    >
      {captionStyle === "pop" ? (
        words.map((w, i) => (
          <Fragment key={`${i}-${w}`}>
            <span className={i < last ? styles.past : i === last ? styles.now : styles.next}>{w}</span>
            {i < words.length - 1 ? wordGap(w, words[i + 1]!) || null : null}
          </Fragment>
        ))
      ) : (
        <span className={styles.text}>{joinWords(words)}</span>
      )}
    </p>
  );
}

/** A clip title over the top of the frame, in volt boxes, like the editor and the export. */
export function DemoTitle({ children }: { children: string }) {
  return (
    <p className={styles.title} aria-hidden="true" style={{ top: `${TITLE_TOP * 100}%`, left: `${MARGIN_H * 100}%`, right: `${MARGIN_H * 100}%`, fontSize: u(ASS_SIZES.title * ASS_EM) }}>
      <span style={{ padding: `${u(ASS_OUTLINE.title * 0.5)} ${u(ASS_OUTLINE.title)}` }}>{children}</span>
    </p>
  );
}
