import type { Metadata } from "next";
import { CaptionStudio } from "@/components/landing/caption-studio";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { pageMetadata } from "@/lib/site";

const title = "Podcast clips: turn video podcast episodes into shorts with AI";
const description = "Turn video podcast episodes into vertical clips: Bamio finds the best moments, keeps the speaker in frame and captions every word, in 100+ languages.";

export const metadata: Metadata = pageMetadata({ title, description, path: "/podcast-clips", absoluteTitle: true });

const page: UseCase = {
  path: "/podcast-clips",
  name: "Podcast clips",
  headline: ["podcast clips,", "without the scrubbing."],
  lede: "Bring an episode from YouTube or a file. Bamio reads the whole conversation, picks the stories, opinions and advice worth sharing, and turns each into a captioned vertical clip.",
  visual: <CaptionStudio />,
  credit: "Demo footage: Mixkit stock video.",
  steps: [
    {
      title: "Bring the episode",
      text: "Paste a link from YouTube or one of 1,000+ other sites, or upload the recording itself: up to 4 GB and 3 hours.",
    },
    {
      title: "Get the best moments",
      text: "Bamio transcribes every word, then picks moments that stand on their own, with a hook up front and a complete thought at the end. Best first, each with a title.",
    },
    {
      title: "Frame the speaker",
      text: "Slide the picture to keep whoever's talking in shot, choose 9:16, 1:1 or 16:9, and export with the captions burned in.",
    },
  ],
  details: [
    { title: "Long episodes", text: "Up to 3 hours per import. For a longer show, or one segment, import just the part you need." },
    { title: "Every word, timed", text: "The transcript has a time for every word, so captions land as each word is said, and clips start and end at a pause." },
    { title: "Mixed languages", text: "Conversations that switch between, say, Nepali or Hindi and English are captioned with each part in its own script." },
    { title: "Your picks too", text: "Mark any moment yourself with I and O, beside the AI's picks, and ask for more clips in another length." },
    { title: "Captions that read well", text: "Pop, Clean or Boxed, in the lower third or the middle, with an optional title. Fix any word before you export." },
    { title: "Ready to post", text: "1080p MP4s with no watermark, for TikTok, YouTube Shorts, Instagram Reels and LinkedIn." },
  ],
  faq: [
    {
      q: "Does it work with audio-only podcasts?",
      a: "Not yet: Bamio makes video clips, so it needs a video recording of the episode. Most video podcasts on YouTube work as they are.",
    },
    {
      q: "How does Bamio choose the moments?",
      a: "It transcribes the episode itself, with a time for every word. Google Gemini then reads the transcript and picks the parts that stand on their own, with a hook at the start and a payoff at the end. Each clip gets a score and a title.",
    },
    { q: "Can I pick the moments myself?", a: "Yes. Mark a start and an end with I and O, or type the times, and the clip gets the same captions and framing as the AI's picks." },
    {
      q: "Which languages work?",
      a: "Over 100, detected for you. English and 24 European languages get punctuation and capitals; in others the captions are lowercase, and you can fix any word in the editor.",
    },
    { q: "Who can I clip?", a: "Your own shows, or ones you have permission to use. Check with your guests and co-hosts before you post." },
  ],
};

export default function PodcastClipsPage() {
  return <UseCasePage page={page} />;
}
