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
const diskMinutes = EDITOR_LIMITS.maxDiskDurationSec / 60;

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
  lede: "A video editor in a browser tab: cut, combine, add transitions, text, logos and music, record a voiceover, change the speed and the shape. Your files stay on your device, the export is made there too, and the basics are free for every Bamio account.",
  visual: shot,
  action: { href: "/editor", label: "Open the editor", note: "Free with a Bamio account. No card, no watermark.", closing: "your video, your device, your edit." },
  credit: "Demo footage: Mixkit stock video.",
  steps: [
    { title: "Add your files", text: "Videos, photos and music from your phone or computer, or a clip you made with Bamio. They’re opened where they are: nothing is sent anywhere." },
    {
      title: "Cut and build",
      text: "Split at the playhead, drag an edge to trim, drag a clip to move it. Add transitions, freeze frames, reversed clips, text in seven typefaces, a logo, stickers, music and a voiceover recorded over the picture.",
    },
    { title: "Export on your device", text: `An MP4 at 720p with no watermark, up to ${minutes} minutes long, or 1080p with a plan. Rendered by your own browser, so there’s no queue.` },
  ],
  details: [
    { title: "Your files stay with you", text: "Your files are read, edited and exported inside your browser. Bamio’s servers never see them, which is also why the basics cost nothing. The one exception is auto captions, and only when you ask for them." },
    { title: "Transitions, freeze frames and reverse", text: "Crossfade, slide, zoom, whip or flash from one clip into the next, hold a frame, or play a clip backwards. Free, like typefaces, outlines and logos over the picture." },
    {
      title: "Captions you can fix",
      text: `With ${hdPlan}, a Bamio clip opens with its captions as words: restyle them, change the typeface, fix a word. With ${proPlan}, captions for any video, with a time for every word, in the languages Bamio transcribes.`,
    },
    { title: "Facecam, split screen and picture in picture", text: `With ${hdPlan}: put a stream’s camera above the game, two videos one over the other, or one in a corner of the other. Plus loudness levelling, and several shapes in one export.` },
    { title: "Auto-reframe, green screen and the beat", text: `With ${proPlan}: the picture follows the speaker’s face when a wide video fills a tall frame, a green background comes out, and cuts land on the music’s beat.` },
    { title: "Silences out in one click", text: `With ${proPlan}: Bamio listens to the sound, finds the pauses and cuts them all at once, gentle, normal or tight. One undo brings them back.` },
    { title: "Music that makes way", text: `With ${proPlan}: music drops while someone talks and comes back in the pauses, and exports can run at 60 frames a second for gameplay and sport.` },
    { title: "Safe zones", text: "Shade the edges of a vertical video where TikTok, Reels and Shorts put their own buttons and captions, so your text stays clear of them." },
    { title: "Any shape", text: "9:16 for TikTok, Shorts and Reels, 1:1, 4:5 or 16:9. A wide video can fill a tall frame, or sit whole over a blurred copy of itself." },
    { title: "Text, stickers and a progress bar", text: "Four text styles, seven typefaces, outlines and shadows, four ways to move, emoji as stickers, and a bar that fills as the video plays." },
    { title: "Speed, looks and slow zooms", text: "From a quarter speed to four times, eight colour looks with brightness, contrast and colour, fades, and a slow push in or pull out." },
    { title: "It’s still there tomorrow", text: "The edit is saved in your browser as you work, files included. Close the tab, come back, carry on. Undo goes back a hundred steps." },
  ],
  faq: [
    {
      q: "Is it really free?",
      a: `The basics are: cutting, combining, transitions, freeze frames, reverse, text in any of the typefaces, stickers, logos, music, a voiceover, every shape, speed and looks, and a 720p export, for every Bamio account, with no watermark and no limit on how many videos you make. ${hdPlan} adds 1080p, captions you can fix on your Bamio clips, facecam and split-screen layouts, loudness levelling and several shapes in one export; ${proPlan} adds auto captions, auto-reframe, silence removal, cutting to the beat, green screen, 60 frames a second, music that ducks under speech, and 4K or hour-long exports.`,
    },
    {
      q: "Is my video uploaded?",
      a: "No. The editor reads your files on your device and renders the export there too. The one exception is auto captions, when you ask for them: the sound of the parts your edit uses is sent to Bamio, transcribed and deleted. The picture never leaves your device.",
    },
    {
      q: "What does it export?",
      a: `An MP4 (H.264 video, AAC sound) at 720p and 30 frames a second, up to ${minutes} minutes long. With a plan, 1080p; with ${proPlan}, 60 frames a second, 4K, and exports up to ${diskMinutes} minutes saved straight to your disk in Chrome or Edge. In a browser that can’t make an MP4, you get a WebM instead and the editor says so.`,
    },
    {
      q: "Which browsers does it work in?",
      a: "It’s built for current Chrome and Edge. Other browsers work where they can decode and encode video themselves; where one can’t, the editor says so before you start.",
    },
    {
      q: "Does it add captions for me?",
      a: `With ${proPlan}, yes: one click captions the whole edit, word by word, and you can restyle them and fix any word. With ${hdPlan}, a Bamio clip opens in the editor with its own captions ready to change. On the free plan, text is typed by you.`,
    },
    { q: "Do I need an account?", a: "Yes, a free one. No card is asked for to use the editor." },
  ],
};

export default function VideoEditorPage() {
  return <UseCasePage page={page} />;
}
