import { captionsOf, clipOf, newEdit, textAt, VOLT, type CaptionStyleId, type CaptionWord, type Edit, type Media } from "./model";

/*
 * A Bamio clip opened in the editor with its captions as words (Starter): the cut of its source
 * (lib/server/editor-source.ts), framed and captioned the way the clip was, so it looks the same
 * and every caption can be restyled and fixed.
 */

/** What the server says about the clip (EditorSource). */
export type ClipSetup = {
  title: string;
  offset: number;
  duration: number;
  aspect: "9:16" | "1:1" | "16:9";
  focusX: number;
  fit: "crop" | "fit";
  captions: { on: boolean; style: CaptionStyleId; position: "bottom" | "middle"; words: CaptionWord[]; language: string | null };
  overlay: string | null;
};

export function editFromClip(setup: ClipSetup, media: Media, now = Date.now()): Edit {
  const edit = newEdit(setup.title.slice(0, 60) || "Bamio clip", now);
  const start = Math.min(setup.offset, Math.max(0, media.duration - 0.1));
  const clip = {
    ...clipOf(media),
    start,
    end: Math.min(media.duration, start + setup.duration),
    fit: setup.fit === "fit" ? ("fit" as const) : ("fill" as const),
    x: Math.max(-1, Math.min(1, setup.focusX * 2 - 1)),
  };
  const texts = setup.overlay ? [{ ...textAt(0, setup.overlay.slice(0, 240)), duration: clip.end - clip.start, style: "volt" as const, color: VOLT, y: 0.14, size: 0.06, animation: "none" as const }] : [];
  const words = setup.captions.words.filter((w) => w.end >= w.start && w.text.trim());
  return {
    ...edit,
    format: setup.aspect,
    media: [media],
    clips: [clip],
    texts,
    ...(words.length > 0
      ? { captions: { ...captionsOf({ [media.id]: words }, setup.captions.language ?? undefined), on: setup.captions.on, style: setup.captions.style, y: setup.captions.position === "middle" ? 0.5 : 0.72 } }
      : {}),
  };
}
