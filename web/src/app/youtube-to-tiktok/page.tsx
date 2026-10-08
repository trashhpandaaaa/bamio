import type { Metadata } from "next";
import { CaptionStudio } from "@/components/landing/caption-studio";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { formatPrice, PLANS } from "@/lib/billing/plans";
import { metadataForUseCase } from "@/lib/site";

export const metadata: Metadata = metadataForUseCase("/youtube-to-tiktok");

const plans = `Plans start at ${formatPrice(PLANS.starter.price.month)} a month for ${PLANS.starter.minutes} minutes of video. Every plan exports 1080p with no watermark.`;

const page: UseCase = {
  path: "/youtube-to-tiktok",
  name: "YouTube to TikTok",
  headline: ["turn YouTube videos into", "TikToks."],
  lede: "A wide YouTube video doesn't fit a phone. Paste the link and Bamio picks the moments that stand on their own, crops them to 9:16 around the speaker and captions every word, ready to post on TikTok.",
  visual: <CaptionStudio />,
  credit: "Demo footage: Mixkit stock video.",
  steps: [
    { title: "Paste the YouTube link", text: "Any video up to 3 hours long, or just the part of it you choose. Live streams work too." },
    {
      title: "Get vertical clips",
      text: "Bamio transcribes the video and picks moments that open on a hook and end on a payoff, in the length you ask for: 15 to 30, 30 to 60 or 60 to 90 seconds.",
    },
    { title: "Download and post", text: "Check the crop, pick a caption style and download a 1080 x 1920 MP4. Upload it to TikTok from your own account." },
  ],
  details: [
    { title: "Cropped to 9:16", text: "Slide the picture so the speaker stays in the vertical frame, or fit the whole wide shot over a blurred background when nothing should be cut off." },
    { title: "Captions people read with the sound off", text: "Every word is timed from the audio and lights up as it's said. Pop, Clean or Boxed, in the lower third or the middle of the screen." },
    { title: "A title on the video", text: "Add a line at the top of the clip that says what it's about, burned in with the captions." },
    { title: "Hooks first", text: "Each clip is rated on how it opens, how it pays off and how much energy it has, so the ones most likely to hold a viewer come first." },
    { title: "Any language", text: "Over 100 spoken languages, detected for you, with a font made for every script." },
    { title: "No watermark", text: "The MP4 is yours as it is: no logo in the corner on any plan." },
  ],
  faq: [
    { q: "How do I turn a YouTube video into a TikTok?", a: "Paste the YouTube link into Bamio, pick one of the clips it finds (or mark your own), check the vertical crop and the captions, and export. You get a 9:16 MP4 to upload to TikTok." },
    { q: "Does Bamio post to TikTok for me?", a: "No. Bamio makes the video file and you upload it yourself, from your own TikTok account." },
    { q: "Will the clip fill the whole phone screen?", a: "Yes. Exports are 1080 x 1920, the 9:16 shape TikTok shows full screen. Square and wide exports are there too." },
    {
      q: "Can I use someone else's YouTube video?",
      a: "Only with their permission. Bamio downloads what you paste, so clip your own videos, or videos you have the rights to use, and check before you post.",
    },
    { q: "How much does it cost?", a: plans },
  ],
};

export default function YoutubeToTiktokPage() {
  return <UseCasePage page={page} />;
}
