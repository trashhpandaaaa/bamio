import type { Metadata } from "next";
import { ClipReel } from "@/components/landing/clip-reel";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { metadataForUseCase } from "@/lib/site";

export const metadata: Metadata = metadataForUseCase("/kick-clips");

const page: UseCase = {
  path: "/kick-clips",
  name: "Kick clips",
  headline: ["turn Kick streams into", "clips."],
  lede: "Paste a Kick link, live or a past broadcast. Bamio captions the stream word by word, finds the moments worth posting and frames them vertical for TikTok, Shorts and Reels.",
  visual: <ClipReel />,
  credit: "Demo footage: Mixkit stock video. The clips shown are examples.",
  steps: [
    { title: "Paste the Kick link", text: "A channel that's live right now, or a past broadcast. Past broadcasts import like any video, whole or just the part you choose." },
    {
      title: "Follow it live",
      text: "For a live channel, choose Follow the stream. Bamio records from the moment you start and keeps going until the stream ends, you stop, or 12 hours are in.",
    },
    { title: "Clip and post", text: "Captions and AI clips follow along as the stream goes. Trim a moment, pick a caption style and export a 1080 x 1920 MP4 while the stream is still on." },
  ],
  details: [
    { title: "Starts from now", text: "Kick keeps only about 30 seconds of a live stream to go back to, so start following early: everything from then on is yours to clip." },
    { title: "Moments found for you", text: "Bamio reads what's said and how loud it gets, then picks clips that open on a hook and end on a payoff, each with a score and a title." },
    { title: "Face cam or gameplay", text: "Slide the picture to the face cam or the action for a vertical clip, or fit the whole screen over a blurred background." },
    { title: "Captions on every word", text: "Each word is timed from the audio and lights up as it's said, in Pop, Clean or Boxed. Fix a word in the editor and its timing stays." },
    { title: "Streams in any language", text: "Over 100 languages, detected for you, with a font made for every script." },
    { title: "No watermark", text: "Every plan exports 1080p MP4s with the captions burned in and nothing added in the corner." },
  ],
  faq: [
    { q: "Can I clip a Kick stream while it's live?", a: "Yes. Paste the channel link and choose Follow the stream. The stream keeps growing in the editor, and you can cut and export clips while it's still on." },
    {
      q: "Can Bamio go back to the start of a Kick stream?",
      a: "Not while it's live: Kick keeps about 30 seconds of history, so recording starts from when you follow. Once the stream is over, paste its past broadcast and import any part of it.",
    },
    { q: "Do Kick past broadcasts work?", a: "Yes. Paste the link to the past broadcast. Videos can be up to 3 hours long; for a longer stream, import the part you want." },
    { q: "Where can I post the clips?", a: "Anywhere that takes an MP4: TikTok, YouTube Shorts, Instagram Reels, X. Bamio gives you the file; you post it from your own account." },
    { q: "Whose streams can I clip?", a: "Your own, or streams you have permission to use. Check with the streamer before you post their moments." },
  ],
};

export default function KickClipsPage() {
  return <UseCasePage page={page} />;
}
