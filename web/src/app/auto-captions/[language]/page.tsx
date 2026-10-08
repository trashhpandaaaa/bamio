import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LanguageCard } from "@/components/landing/feature-cards";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { CAPTION_LANGUAGES, captionLanguage, captionLanguageMeta, punctuated, type CaptionLanguage } from "@/lib/caption-languages";
import { pageMetadata } from "@/lib/site";

/*
 * Captions in one language (/auto-captions/hindi): what people search for by language. One
 * page per entry of CAPTION_LANGUAGES, built once like the other marketing pages; any other
 * address is a 404. What each says about the language comes from how Bamio transcribes it.
 */

export const dynamicParams = false;

export function generateStaticParams() {
  return CAPTION_LANGUAGES.map((l) => ({ language: l.slug }));
}

type Props = { params: Promise<{ language: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const language = captionLanguage((await params).language);
  if (!language) return {};
  return pageMetadata({ ...captionLanguageMeta(language), absoluteTitle: true });
}

function pageFor(l: CaptionLanguage): UseCase {
  const latin = l.script.startsWith("Latin");
  const marks = punctuated(l);
  return {
    path: `/auto-captions/${l.slug}`,
    parent: { name: "Auto captions", path: "/auto-captions" },
    name: `${l.name} captions`,
    headline: [`${l.name} captions,`, "word by word."],
    lede: `Bamio listens to ${l.name} speech, writes it in ${l.script}, and times every word from the audio. Pick a style, fix a word if you need to, and export a vertical video with the captions burned in.`,
    visual: <LanguageCard lead={{ lang: l.code, words: l.sample }} />,
    own: { lang: l.code, rtl: l.rtl, headline: l.own.headline, text: l.own.text },
    steps: [
      { title: "Import the video", text: "Paste a link from YouTube, Twitch, Kick or 1,000+ other sites, or upload a file up to 4 GB." },
      {
        title: `${l.name}, detected`,
        text: `Bamio listens at five points of the video and works out that it's in ${l.name}. If it ever gets that wrong, pick ${l.name} yourself and it transcribes again.`,
      },
      { title: "Style and export", text: "Choose Pop, Clean or Boxed, put the captions in the lower third or the middle, add a title, and export a 1080p MP4." },
    ],
    details: [
      marks
        ? { title: "Punctuation and capitals", text: `${l.name} captions come with full stops, commas, question marks and capital letters, so each line reads like a sentence.` }
        : {
            title: "Plain words, no punctuation",
            text: `${l.name} captions come as the words themselves, ${latin ? "lowercase and " : ""}without punctuation, which suits short lines on screen. Add a mark where you want one in the editor.`,
          },
      latin
        ? { title: "Every accent in place", text: `${l.name}'s accented letters are drawn as heavy as the rest of the caption, and the same in the preview as in the exported video.` }
        : {
            title: `A font made for ${l.script}`,
            text: `${l.name} is drawn in ${l.font}, as heavy as Bamio's Latin captions${l.rtl ? ", right to left, with its letters joined" : l.script === "Devanagari" ? ", with its conjuncts joined" : ""}. The preview and the export use the same font.`,
          },
      marks
        ? {
            title: `${l.name} with English in it`,
            text: `When a speaker drops an English phrase into ${l.name}${l.mix ? ` (${l.mix})` : ""}, the phrase is written as English, and the rest stays ${l.name}.`,
          }
        : latin
          ? { title: "Videos that switch to English", text: `When Bamio hears English as well as ${l.name} in a video, the English parts are checked against its English model and written as English, with punctuation.` }
          : {
              title: `${l.name} and English in one video`,
              text: `${l.mix ? `${l.mix} works: ` : ""}English parts are written in English, in Latin letters with punctuation, and ${l.name} stays in ${l.script}. Each part keeps its own font.`,
            },
      l.unspaced
        ? {
            title: "Words found for you",
            text: `${l.name} isn't written with spaces, so Bamio finds where each word ends, times it, and breaks caption lines only between words, short enough to fit the frame.`,
          }
        : { title: "A time for every word", text: "Each word lights up as it's said, timed from the audio itself, so the captions keep up with fast talkers and long videos alike." },
      { title: "Fix any word", text: "Names and slang can come out wrong in any language. Click a word in the editor to correct it; its timing stays." },
      { title: `AI clips from ${l.name} videos`, text: `Bamio's clip finding works from the ${l.name} transcript, and writes each clip's title and the reason it was picked in ${l.name}.` },
    ],
    faq: [
      {
        q: `How do I add ${l.name} captions to a video?`,
        a: `Paste the video's link into Bamio or upload the file. Bamio transcribes the ${l.name} speech with a time for every word. Cut a clip, choose a caption style and export: the captions are burned into the video.`,
      },
      {
        q: `Do I have to tell Bamio the video is in ${l.name}?`,
        a: `No. The language is detected from the speech. You can also pick ${l.name} when you import, or change the language afterwards and transcribe again.`,
      },
      {
        q: `How accurate are ${l.name} captions?`,
        a: "Close on clear speech; rougher over music, crowds or people talking at once, and with names. Every word can be fixed in the editor before you export.",
      },
      {
        q: `Can Bamio translate ${l.name} captions into English?`,
        a: `Not yet. Captions are in the language that's spoken: ${l.name} speech gets ${l.name} captions.`,
      },
      { q: "Do I get a subtitle file?", a: "Bamio burns the captions into the video, which is what TikTok, Shorts and Reels viewers see on autoplay. A separate subtitle file isn't available yet." },
    ],
    related: { title: "Captions in other languages", links: CAPTION_LANGUAGES.filter((other) => other.slug !== l.slug).map((other) => ({ href: `/auto-captions/${other.slug}`, label: other.name })) },
  };
}

export default async function CaptionLanguagePage({ params }: Props) {
  const language = captionLanguage((await params).language);
  if (!language) notFound();
  return <UseCasePage page={pageFor(language)} />;
}
