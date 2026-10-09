import type { Metadata } from "next";
import { UseCasePage, type UseCase } from "@/components/site/use-case";
import { PLANS } from "@/lib/billing/plans";
import { EDITOR_FEATURES } from "@/lib/editor/features";
import { EDITOR_LIMITS } from "@/lib/editor/model";
import { metadataForUseCase } from "@/lib/site";
import styles from "./video-editor.module.css";

export const metadata: Metadata = metadataForUseCase("/video-editor");

const minutes = EDITOR_LIMITS.maxDurationSec / 60;
/** The plans the paid features start at, by name, from the editor's own table: the page can't drift from what the editor does. */
const hdPlan = PLANS[EDITOR_FEATURES.hd.needs].name;
const proPlan = PLANS[EDITOR_FEATURES.silence.needs].name;

/** The editor itself, with stock footage in it (made by the e2e suite: E2E_EDITOR_SHOT=1, see tests/e2e/editor.spec.ts). */
const shot = (
  <div className={`studio ${styles.shot}`}>
    {/* A plain file from /landing, like the landing page's stills. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img
      src="/landing/editor.webp"
      alt="Bamio’s editor: a vertical video in the preview with a title and a caption on it, the clips, text and music on a timeline below, and text settings beside it."
      width={1440}
      height={840}
      decoding="async"
      fetchPriority="high"
    />
  </div>
);

const page: UseCase = {
  path: "/video-editor",
  name: "Video editor",
  headline: ["edit in your browser,", "keep it on your device."],
  lede: "A video editor in a browser tab: cut, combine, add text and music, record a voiceover, change the speed and the shape. Nothing is uploaded, the export is made on your own device, and the basics are free for every Bamio account.",
  visual: shot,
  action: { href: "/editor", label: "Open the editor", note: "Free with a Bamio account. No card, no watermark.", closing: "your video, your device, your edit." },
  credit: "Demo footage: Mixkit stock video.",
  steps: [
    { title: "Add your files", text: "Videos, photos and music from your phone or computer, or a clip you made with Bamio. They’re opened where they are: nothing is sent anywhere." },
    {
      title: "Cut and build",
      text: "Split at the playhead, drag an edge to trim, drag a clip to move it. Add text that pops, types on or rises, stickers, music and a voiceover recorded over the picture.",
    },
    { title: "Export on your device", text: `An MP4 at 720p with no watermark, up to ${minutes} minutes long, or 1080p with a plan. Rendered by your own browser, so there’s no queue.` },
  ],
  details: [
    { title: "Nothing is uploaded", text: "Your files are read, edited and exported inside your browser. Bamio’s servers never see them, which is also why the basics cost nothing." },
    { title: "Silences out in one click", text: `With ${proPlan}: Bamio listens to the sound, finds the pauses and cuts them all at once, gentle, normal or tight. One undo brings them back.` },
    { title: "Music that makes way", text: `With ${proPlan}: music drops while someone talks and comes back in the pauses, and exports can run at 60 frames a second for gameplay and sport.` },
    { title: "Safe zones", text: "Shade the edges of a vertical video where TikTok, Reels and Shorts put their own buttons and captions, so your text stays clear of them." },
    { title: "Any shape", text: "9:16 for TikTok, Shorts and Reels, 1:1, 4:5 or 16:9. A wide video can fill a tall frame, or sit whole over a blurred copy of itself." },
    { title: "Text, stickers and a progress bar", text: "Four text styles in Bamio’s type, four ways to move, emoji as stickers, and a bar that fills as the video plays." },
    { title: "Speed, looks and slow zooms", text: "From a quarter speed to four times, eight colour looks with brightness, contrast and colour, fades, and a slow push in or pull out." },
    { title: "It’s still there tomorrow", text: "The edit is saved in your browser as you work, files included. Close the tab, come back, carry on. Undo goes back a hundred steps." },
  ],
  faq: [
    {
      q: "Is it really free?",
      a: `The basics are: cutting, combining, text, stickers, music, a voiceover, every shape, speed and looks, and a 720p export, for every Bamio account, with no watermark and no limit on how many videos you make. A plan adds 1080p export (from ${hdPlan}); ${proPlan} adds silence removal, 60 frames a second and music that ducks under speech.`,
    },
    { q: "Is my video uploaded?", a: "No. The editor reads your files on your device and renders the export there too. They never reach Bamio’s servers." },
    {
      q: "What does it export?",
      a: `An MP4 (H.264 video, AAC sound) at 720p and 30 frames a second, up to ${minutes} minutes long. With a plan, 1080p; with ${proPlan}, 60 frames a second too. In a browser that can’t make an MP4, you get a WebM instead and the editor says so.`,
    },
    {
      q: "Which browsers does it work in?",
      a: "It’s built for current Chrome and Edge. Other browsers work where they can decode and encode video themselves; where one can’t, the editor says so before you start.",
    },
    {
      q: "Does it add captions for me?",
      a: "Not in the editor: text there is typed by you. Bamio’s AI clips come with word-by-word captions already burned in, and any exported clip can be opened in the editor to add music, text or other clips.",
    },
    { q: "Do I need an account?", a: "Yes, a free one. No card is asked for to use the editor." },
  ],
};

export default function VideoEditorPage() {
  return <UseCasePage page={page} />;
}
