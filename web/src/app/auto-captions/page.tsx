import type { Metadata } from "next";
import { LanguageCard } from "@/components/landing/feature-cards";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { pageMetadata } from "@/lib/site";

const title = "Auto captions for short videos, word by word, in 100+ languages";
const description =
  "Word-by-word captions for TikTok, Shorts and Reels, timed from the audio and burned into a 1080p MP4. Detected in 100+ languages, with the right font for every script.";

export const metadata: Metadata = pageMetadata({ title, description, path: "/auto-captions", absoluteTitle: true });

const page: UseCase = {
  path: "/auto-captions",
  name: "Auto captions",
  headline: ["auto captions,", "word by word."],
  lede: "Bamio times every word from the audio and highlights it as it's said. Pick a style, fix a word if you need to, and export a vertical video with the captions burned in.",
  visual: <LanguageCard />,
  steps: [
    { title: "Import the video", text: "Paste a link from YouTube, Twitch, Kick or 1,000+ other sites, or upload a file up to 4 GB." },
    {
      title: "Every word, timed",
      text: "Bamio transcribes the video itself, with a time for every word. The language is detected for you, or pick it from a list of about 120.",
    },
    { title: "Style and export", text: "Choose Pop, Clean or Boxed, put the captions in the lower third or the middle, add a title, and export a 1080p MP4." },
  ],
  details: [
    { title: "Pop, Clean or Boxed", text: "Pop shows big words revealed as they're spoken; Clean is one line of plain subtitles; Boxed is white text on dark boxes." },
    { title: "The right font for every script", text: "Devanagari, Arabic, Japanese, Korean, Thai and more each get a font made for them, with conjuncts joined and right-to-left text the right way round." },
    { title: "Mixed languages", text: "When a speaker switches between a language and English, each part is written in its own script." },
    { title: "Preview matches export", text: "The editor draws captions with the same fonts, sizes and outlines as the exported video." },
    { title: "Fix any word", text: "Click a word in the editor to correct it; its timing stays." },
    { title: "Burned in", text: "Captions are part of the video, so they show on every app, autoplay and all, with nothing to upload separately." },
  ],
  faq: [
    {
      q: "Which languages are supported?",
      a: "Over 100, detected for you: English, Spanish, Hindi, Nepali, Japanese, Arabic, Korean and many more. English and 24 European languages get punctuation and capitals; in others the captions are lowercase.",
    },
    { q: "How accurate are the captions?", a: "Very close for English and widely spoken languages, rougher for some others. Every word can be fixed in the editor before you export." },
    { q: "Do I get a subtitle file?", a: "Bamio burns the captions into the video, which is what TikTok, Shorts and Reels viewers see on autoplay. A separate subtitle file isn't available yet." },
    { q: "Can I turn captions off?", a: "Yes, per clip, or for every new import in Clip defaults." },
    { q: "Do right-to-left languages work?", a: "Yes. Arabic, Hebrew, Urdu and other right-to-left scripts are laid out and joined correctly, in the preview and the export." },
  ],
};

export default function AutoCaptionsPage() {
  return <UseCasePage page={page} />;
}
