import { CAPTION_LANGUAGES, captionLanguage, punctuated } from "@/lib/caption-languages";
import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio adds word-by-word captions in this language";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export function generateStaticParams() {
  return CAPTION_LANGUAGES.map((l) => ({ language: l.slug }));
}

/** In Latin letters only: the preview's one font has no others. */
export default async function Image({ params }: { params: Promise<{ language: string }> }) {
  const language = captionLanguage((await params).language);
  const name = language?.name ?? "Auto";
  return renderOg({
    headline: [`${name} captions,`, "word by word."],
    facts: ["Detected for you", language && punctuated(language) ? "With punctuation" : "A font for every script", "Burned into 1080p"],
    caption: "every word right on time",
  });
}
