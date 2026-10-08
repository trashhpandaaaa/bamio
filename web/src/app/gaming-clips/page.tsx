import type { Metadata } from "next";
import { ClipReel } from "@/components/landing/clip-reel";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { metadataForUseCase } from "@/lib/site";

export const metadata: Metadata = metadataForUseCase("/gaming-clips");

const page: UseCase = {
  path: "/gaming-clips",
  name: "Gaming clips",
  headline: ["hours of gameplay,", "the best minute."],
  lede: "Paste a stream or a gameplay video. Bamio listens to the commentary, finds where it gets loud and where something lands, and turns those moments into vertical clips with captions on every word.",
  visual: <ClipReel />,
  credit: "Demo footage: Mixkit stock video. The clips shown are examples.",
  steps: [
    { title: "Paste the stream or video", text: "A Twitch, Kick or YouTube link, live or finished, or a recording from your own computer up to 4 GB." },
    {
      title: "Bamio finds the highlights",
      text: "It transcribes what's said with a time for every word and measures how loud each second is, so the clutch, the fail and the shout all stand out. Each clip gets a score and a title.",
    },
    { title: "Frame it and export", text: "Put the face cam or the action in the vertical frame, pick a caption style and export a 1080 x 1920 MP4 for TikTok, Shorts and Reels." },
  ],
  details: [
    { title: "Loud moments count", text: "Shouting, laughing and a sudden reaction are signs something happened. Bamio marks the loudest lines when it picks clips." },
    { title: "Face cam or gameplay", text: "Slide the picture to whichever part of the screen matters, or fit the whole screen over a blurred background so nothing is cropped out." },
    { title: "While you're still live", text: "Follow a live stream and clip it as it goes: post the moment while chat is still talking about it." },
    { title: "Mark your own", text: "Know where the play was? Set the start and end yourself with I and O on the timeline, and Bamio captions it." },
    { title: "Long sessions", text: "Videos up to 3 hours import whole. From a longer stream, import the part you want, and only that part is downloaded." },
    { title: "Captions in your language", text: "Over 100 languages, detected for you, in a font made for the script." },
  ],
  faq: [
    {
      q: "Does it work on gameplay with no commentary?",
      a: "Bamio finds moments from what's said and how loud the talking gets. A video where nobody speaks gets no captions or AI clips, but you can still cut and frame clips by hand.",
    },
    { q: "Which games does it work with?", a: "Any. Bamio doesn't read the game itself: it works from your voice, so it suits every game you talk over." },
    { q: "Can I clip a stream that's still going?", a: "Yes. Paste the live link and choose Follow the stream. On Twitch it can go back to the start of the stream when past broadcasts are on." },
    { q: "Can I show the face cam and the gameplay together?", a: "Fit the whole screen in the vertical frame over a blurred background and both stay in shot. Stacking the face cam above the gameplay isn't available yet." },
    { q: "Whose streams can I clip?", a: "Your own, or streams you have permission to use. Check with the streamer before you post their moments." },
  ],
};

export default function GamingClipsPage() {
  return <UseCasePage page={page} />;
}
