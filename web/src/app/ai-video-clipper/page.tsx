import type { Metadata } from "next";
import { MomentFinder } from "@/components/landing/moment-finder";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { formatPrice, FREE_TRIAL, PLANS } from "@/lib/billing/plans";
import { metadataForUseCase } from "@/lib/site";

export const metadata: Metadata = metadataForUseCase("/ai-video-clipper");

const cost = `Your first video is free, up to ${FREE_TRIAL.minutes} minutes (a card is needed to start, and it isn't charged). Plans start at ${formatPrice(PLANS.starter.price.month)} a month for ${PLANS.starter.minutes} minutes of video.`;

const page: UseCase = {
  path: "/ai-video-clipper",
  name: "AI video clipper",
  headline: ["the AI video clipper that finds", "the hook."],
  lede: "Give Bamio a long video. It reads every word, picks the parts that hold up on their own, and hands back short vertical clips with a score, a title and captions, ready to post.",
  visual: <MomentFinder />,
  credit: "Demo footage: Mixkit stock video.",
  steps: [
    { title: "Add a long video", text: "Paste a link from YouTube, Twitch, Kick or 1,000+ other sites, or upload a file up to 4 GB. Videos can be up to 3 hours long." },
    {
      title: "The AI picks the clips",
      text: "Bamio transcribes the video itself, with a time for every word. The AI then reads the whole transcript and picks moments that start on a hook and finish on a payoff.",
    },
    { title: "Edit and export", text: "Trim on the filmstrip, reframe to 9:16, 1:1 or 16:9, choose a caption style and download a 1080p MP4." },
  ],
  details: [
    { title: "A score you can read", text: "Every clip is rated on its hook, its payoff and its energy, and comes with the reason it was picked, so you know why it's first." },
    { title: "Cuts where sentences end", text: "Every word has its own time, so a clip starts and ends at a sentence or a pause, never in the middle of a word." },
    { title: "The length you want", text: "Ask for 15 to 30, 30 to 60 or 60 to 90 second clips. Ask again in another length and Bamio skips the moments you already have." },
    { title: "Captions on every word", text: "Timed from the audio and highlighted as they're said, in over 100 languages, with a font made for each script." },
    { title: "Just the part you need", text: "From a long video, import only a segment: Bamio downloads just that part, and only it counts against your minutes." },
    { title: "You stay in charge", text: "Every suggestion can be trimmed, reframed, retitled or thrown away, and you can mark your own clips from scratch." },
  ],
  faq: [
    {
      q: "How does the AI decide what to clip?",
      a: "Bamio transcribes the video and measures how loud each second is. Google Gemini reads the transcript and picks parts that make sense on their own, then rates each on hook, payoff and energy. The ratings make the score.",
    },
    { q: "What kinds of video work best?", a: "Videos where people talk: podcasts, interviews, streams, talks, lessons, vlogs. A video with no speech gets no AI clips, though you can still cut clips by hand." },
    { q: "Can I get more clips from the same video?", a: "Yes. Ask for more, in the same length or another, and Bamio looks again without repeating the moments you already have." },
    { q: "Do I need to install anything?", a: "No. Bamio runs in the browser, on a phone or a computer." },
    { q: "Is it free to try?", a: cost },
  ],
};

export default function AiVideoClipperPage() {
  return <UseCasePage page={page} />;
}
