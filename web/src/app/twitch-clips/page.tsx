import type { Metadata } from "next";
import { MomentFinder } from "@/components/landing/moment-finder";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { pageMetadata } from "@/lib/site";

const title = "Twitch clip maker: clip Twitch and Kick streams, even live";
const description =
  "Paste a Twitch or Kick link and Bamio turns the stream into vertical clips with word-by-word captions. Follow a live stream from its start and clip while it's still on.";

export const metadata: Metadata = pageMetadata({ title, description, path: "/twitch-clips", absoluteTitle: true });

const page: UseCase = {
  path: "/twitch-clips",
  name: "Twitch and Kick clips",
  headline: ["clip your stream", "while it's live."],
  lede: "Paste a Twitch, Kick or YouTube live link. Bamio follows the stream from as far back as the site keeps it, captions it as it goes and finds the moments, so you can post clips before the stream ends.",
  visual: <MomentFinder />,
  credit: "Demo footage: Mixkit stock video.",
  steps: [
    { title: "Paste the stream", text: "A live Twitch, Kick or YouTube link, or a past broadcast: VODs and highlights import like any video." },
    {
      title: "Follow it, or capture a part",
      text: "Follow the stream and Bamio keeps adding to it until it ends, you stop, or 12 hours are in. Or capture just a stretch: how far back to start and how long to record.",
    },
    { title: "Clip while it grows", text: "Captions and AI clips follow along as the stream goes. Mark a moment, export it and post it while you're still live." },
  ],
  details: [
    {
      title: "Back to the start",
      text: "On Twitch, Bamio can go back to the start of the stream through its in-progress VOD (when past broadcasts are on). YouTube goes back as far as its rewind; Kick records from now.",
    },
    { title: "Captions as it goes", text: "New stream is captioned in pieces as it comes in, word by word, and AI clips are found as the speech builds up." },
    { title: "When it ends", text: "The stream becomes a normal video with the same timeline, and your clips stay where you marked them." },
    { title: "Face cam or gameplay", text: "Slide the picture to the face cam or the action for a vertical clip, or fit the whole screen over a blurred background." },
    { title: "Any language", text: "Streams in over 100 languages, detected for you, with the right font for every script." },
    { title: "Ready for TikTok and Shorts", text: "1080 x 1920 MP4s with the captions burned in and no watermark." },
  ],
  faq: [
    { q: "Can I clip a Twitch stream that's still live?", a: "Yes. Paste the live link and choose Follow the stream. You can clip and export while it's still on; the stream keeps growing in the editor." },
    {
      q: "How far back can Bamio go?",
      a: "On Twitch, to the start of the stream, when the streamer keeps past broadcasts. On YouTube, as far as the stream's rewind history (often an hour). Kick only keeps about 30 seconds, so a Kick capture starts from now.",
    },
    { q: "Does it work with Kick?", a: "Yes, live streams and past broadcasts. Live Kick streams are recorded from the moment you start, since Kick keeps no rewind history." },
    {
      q: "Will Twitch's ads end up in my clips?",
      a: "When a stream has no VOD (past broadcasts off), Bamio records the live picture, which can include Twitch's ads. Trim them out in the editor.",
    },
    { q: "Whose streams can I clip?", a: "Your own, or streams you have permission to use. Check with the streamer before you post their moments." },
  ],
};

export default function TwitchClipsPage() {
  return <UseCasePage page={page} />;
}
