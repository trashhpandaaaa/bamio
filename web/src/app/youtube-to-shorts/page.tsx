import type { Metadata } from "next";
import { ClipFlow } from "@/components/landing/clip-flow";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { formatPrice, PLANS } from "@/lib/billing/plans";
import { pageMetadata } from "@/lib/site";

const title = "YouTube to Shorts: turn long videos into Shorts with AI";
const description =
  "Paste a YouTube link and Bamio finds the moments that work as Shorts, frames them 9:16 and captions every word. Import only part of a long video. 1080p, no watermark.";

export const metadata: Metadata = pageMetadata({ title, description, path: "/youtube-to-shorts", absoluteTitle: true });

const plans = `Plans start at ${formatPrice(PLANS.starter.price.month)} a month for ${PLANS.starter.minutes} minutes of video. Every plan exports 1080p with no watermark.`;

const page: UseCase = {
  path: "/youtube-to-shorts",
  name: "YouTube to Shorts",
  headline: ["turn any YouTube video into", "Shorts."],
  lede: "Paste a YouTube link. Bamio reads every word of the video, picks the moments that hold up on their own, frames them vertical and captions them, ready for YouTube Shorts, TikTok and Reels.",
  visual: <ClipFlow />,
  credit: "Demo footage: Mixkit stock video.",
  steps: [
    {
      title: "Paste the link",
      text: "Any YouTube video up to 3 hours long. Only need one segment of a long video? Import just that part, and Bamio downloads only what you picked.",
    },
    {
      title: "Bamio finds the moments",
      text: "It transcribes the video with a time for every word, then picks clips that open on a hook and end on a payoff. Each gets a score, a title and the reason it was picked.",
    },
    {
      title: "Edit and export",
      text: "Trim on the filmstrip, slide the picture to keep the speaker in shot, choose a caption style and download a 1080 x 1920 MP4, ready to upload as a Short.",
    },
  ],
  details: [
    { title: "Lengths that fit Shorts", text: "Ask for 15 to 30, 30 to 60 or 60 to 90 second clips. Any clip can be trimmed from 3 seconds up to 3 minutes, the longest a Short can be." },
    { title: "Captions on every word", text: "Each word is timed from the audio and lights up as it's said. Fix a word in the editor, and the export matches the preview." },
    { title: "Any language", text: "The spoken language is detected for you, in over 100 languages, including videos that mix a language with English." },
    { title: "Reframed in a drag", text: "Slide the picture to keep the subject in the 9:16 frame, or fit the whole shot over a blurred background. 1:1 and 16:9 too." },
    { title: "More clips when you want them", text: "Ask for more in another length and Bamio skips the moments you already have. Mark your own with I and O as well." },
    { title: "No watermark", text: "Every plan exports 1080p MP4s without a watermark, with the captions and an optional title burned in." },
  ],
  faq: [
    {
      q: "Can I turn any YouTube video into Shorts?",
      a: "Only videos you own or have permission to use. Bamio downloads what you paste, so check the rights before you post a clip of someone else's video.",
    },
    { q: "How long can a YouTube Short be?", a: "Up to 3 minutes. Bamio suggests clips in the length you choose, from 15 to 90 seconds, and you can trim any clip from 3 seconds up to 3 minutes." },
    {
      q: "Do I have to import the whole video?",
      a: "No. Choose a start and an end, and Bamio imports only that part, so a long video is quicker and uses only that part's minutes. Videos over 3 hours have to be imported in parts.",
    },
    {
      q: "Does it work with YouTube live streams?",
      a: "Yes. Paste the live link and Bamio follows the stream, starting as far back as its rewind history allows, so you can clip and export while it's still live.",
    },
    { q: "How much does it cost?", a: plans },
  ],
};

export default function YoutubeToShortsPage() {
  return <UseCasePage page={page} />;
}
