import type { Metadata } from "next";
import { ClipFlow } from "@/components/landing/clip-flow";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { metadataForUseCase } from "@/lib/site";

export const metadata: Metadata = metadataForUseCase("/video-to-reels");

const page: UseCase = {
  path: "/video-to-reels",
  name: "Video to Reels",
  headline: ["turn long videos into", "Reels."],
  lede: "Bring an interview, a talk, a vlog or a stream. Bamio finds the parts that work on their own, frames them vertical and burns in word-by-word captions, so each one is ready to post as an Instagram Reel.",
  visual: <ClipFlow />,
  credit: "Demo footage: Mixkit stock video.",
  steps: [
    { title: "Bring the video", text: "Paste a link from YouTube, Twitch, Kick or 1,000+ other sites, or upload a file up to 4 GB from your phone or computer." },
    { title: "Pick your Reels", text: "Bamio reads every word and suggests clips with a score, a title and the reason each was picked. Ask for more, or mark your own." },
    { title: "Export 9:16", text: "Trim to the frame, choose the caption style and download a 1080 x 1920 MP4. Post it to Instagram from your own account." },
  ],
  details: [
    { title: "Made for the Reels frame", text: "Full-screen 9:16 at 1080 x 1920. Put the captions in the middle of the screen to keep them clear of the buttons and text Instagram lays over the bottom." },
    { title: "Square and wide too", text: "Export the same clip as 1:1 for the feed or 16:9 for wherever else it's going." },
    { title: "Keep the speaker in shot", text: "Slide the picture to follow who's talking, or fit the whole frame over a blurred background." },
    { title: "Captions burned in", text: "They're part of the video, so they show on autoplay with the sound off, in the same font and place on every phone." },
    { title: "Lengths that suit Reels", text: "Clips of 15 to 30, 30 to 60 or 60 to 90 seconds, and any clip can be trimmed from 3 seconds up to 3 minutes." },
    { title: "Any language", text: "Captions in over 100 languages, detected for you, including videos that switch between a language and English." },
  ],
  faq: [
    { q: "How do I make a Reel from a long video?", a: "Paste the video's link or upload the file. Bamio suggests the moments worth posting; pick one, check the vertical crop and captions, and export a 9:16 MP4 to upload as a Reel." },
    { q: "Does Bamio post to Instagram?", a: "No. Bamio makes the video file and you post it yourself, from your own Instagram account." },
    { q: "Can I upload a video from my phone?", a: "Yes. Bamio runs in the browser on phones and computers, and takes files up to 4 GB." },
    { q: "Is there a watermark?", a: "No. Every plan exports 1080p MP4s with no watermark." },
    { q: "Whose videos can I use?", a: "Your own, or videos you have permission to use. Check the rights before you post a clip of someone else's video." },
  ],
};

export default function VideoToReelsPage() {
  return <UseCasePage page={page} />;
}
