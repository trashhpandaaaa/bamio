import { Check, CloudArrowUp, DownloadSimple, Globe, TwitchLogo, UploadSimple, YoutubeLogo } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { AiMark } from "@/components/brand";
import { CaptionStudio } from "@/components/landing/caption-studio";
import { ClipFlow } from "@/components/landing/clip-flow";
import { ClipReel } from "@/components/landing/clip-reel";
import { LanguageCard, LiveCard } from "@/components/landing/feature-cards";
import { LinkForm } from "@/components/landing/link-form";
import { MomentFinder } from "@/components/landing/moment-finder";
import { StickyLinkBar } from "@/components/landing/sticky-link-bar";
import { FaqList, faqPlain, type FaqItem } from "@/components/site/faq";
import { JsonLd } from "@/components/site/json-ld";
import { SiteFooter, SiteHeader, type SiteLink } from "@/components/site/site-chrome";
import { formatPrice, FREE_TRIAL, PLANS } from "@/lib/billing/plans";
import { COMPANY } from "@/lib/legal";
import { faqData, HOME_DESCRIPTION, HOME_TITLE, ORGANIZATION, pageMetadata, softwareData, WEBSITE } from "@/lib/site";
import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = pageMetadata({ title: HOME_TITLE, description: HOME_DESCRIPTION, path: "/", absoluteTitle: true });

const LINKS: SiteLink[] = [
  { href: "#how", label: "How it works" },
  { href: "#captions", label: "Captions" },
  { href: "#languages", label: "Languages" },
  { href: "/pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
];

const FAQ: FaqItem[] = [
  {
    q: "How does Bamio pick the moments?",
    a: "Bamio transcribes the video itself, with a time for every word. Google Gemini then reads the transcript and picks the parts that stand on their own, with a hook at the start and a payoff at the end. Each clip gets a score and a title.",
  },
  {
    q: "Which sites can I clip from?",
    a: "YouTube, Twitch and Kick, plus over 1,000 other video sites. You can also upload a file up to 4 GB. Videos can be up to 3 hours long; for longer ones, import just the part you want.",
  },
  {
    q: "Which languages work?",
    a: "Over 100, detected for you, or pick one yourself. English and 24 European languages get punctuation and capitals. Captions use a font made for each script, and when a video mixes a language with English, each part keeps its own script.",
  },
  {
    q: "Can I clip a live stream?",
    a: "Yes. Paste the live link and choose Follow the stream. Bamio captures it from as far back as the site allows (on Twitch, up to 6 hours back) and keeps adding to it, so you can clip and export while it’s still live.",
  },
  {
    q: "What do I get?",
    a: "An MP4 at 1080p in 9:16, 1:1 or 16:9, with captions burned in (Pop, Clean or Boxed) and an optional title. It’s ready to post on TikTok, YouTube Shorts and Instagram Reels.",
  },
  {
    q: "How much does it cost?",
    a: (
      <>
        Plans start at {formatPrice(PLANS.starter.price.month)} a month for {PLANS.starter.minutes} minutes of video, or {formatPrice(PLANS.starter.price.quarter)} for 3
        months. Every plan exports 1080p with no watermark, and your first video is free (up to {FREE_TRIAL.minutes} minutes). <Link href="/pricing">See the plans</Link>.
      </>
    ),
    text: `Plans start at ${formatPrice(PLANS.starter.price.month)} a month for ${PLANS.starter.minutes} minutes of video, or ${formatPrice(PLANS.starter.price.quarter)} for 3 months. Every plan exports 1080p with no watermark, and your first video is free (up to ${FREE_TRIAL.minutes} minutes).`,
  },
  {
    q: "Whose videos can I clip?",
    a: COMPANY.ready ? (
      <>
        Only videos you own or have permission to use. Bamio downloads what you paste, so check the rights before you post a clip. Rights holders can{" "}
        <Link href="/takedown">report a misuse</Link>.
      </>
    ) : (
      "Only videos you own or have permission to use. Bamio downloads what you paste, so check the rights before you post a clip."
    ),
    text: "Only videos you own or have permission to use. Bamio downloads what you paste, so check the rights before you post a clip.",
  },
];

export default function Home() {
  return (
    <>
      <SiteHeader links={LINKS} menu={[{ href: "#moments", label: "How it picks" }, ...LINKS]} />

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={`container ${styles.heroCopy}`}>
            <h1 id="hero-title" className="t-display-2xl">
              clip the moments that <span className="hl">hook.</span>
            </h1>
            <p className={styles.lede}>Paste a YouTube, Twitch or Kick link. Bamio finds the best moments, frames them vertical and captions every word.</p>
            <div className={styles.heroAction}>
              <LinkForm variant="hero" id="hero-link" />
              <span className={styles.or}>or</span>
              <Link href="/new?mode=upload" className={`btn btn-secondary btn-lg ${styles.upload}`}>
                <UploadSimple size={18} aria-hidden />
                Upload a file
              </Link>
            </div>
          </div>
          <div className={`container ${styles.demo}`}>
            <ClipFlow />
          </div>
        </section>

        <section id="clips" className={`container ${styles.section}`} aria-labelledby="clips-title">
          <div className={`${styles.head} reveal`}>
            <h2 id="clips-title" className="t-display-lg">
              the plays worth <span className="hl">posting.</span>
            </h2>
            <p className={styles.sub}>Bamio pulls the clutches, the rage and the close calls out of hours of gameplay, then cuts them vertical and captions every word.</p>
          </div>
          <div className="reveal">
            <ClipReel />
          </div>
        </section>

        <section id="moments" className={`container ${styles.section}`} aria-labelledby="moments-title">
          <div className={`${styles.head} ${styles.headWide} reveal`}>
            <h2 id="moments-title" className="t-display-lg">
              AI that finds the moment, <span className="hl">not just a clip.</span>
            </h2>
            <p className={styles.sub}>Bamio reads every word of the video, then starts each clip on the hook and ends it on the payoff, at a natural break.</p>
          </div>
          <div className="reveal">
            <MomentFinder />
          </div>
        </section>

        <section id="how" className={`container ${styles.section}`} aria-labelledby="how-title">
          <h2 id="how-title" className="t-display-lg reveal">
            long video in, <span className="hl">shorts out.</span>
          </h2>
          <div className={`${styles.bento} reveal`}>
            <article className={`${styles.cell} ${styles.cellLink}`}>
              <h3 className="t-heading-md">Bring any long video</h3>
              <p>Streams, VODs, podcasts and uploads up to 3 hours. Only need part of a long stream? Import just that part.</p>
              <div className={styles.sources} aria-hidden="true">
                <span className="chip">
                  <YoutubeLogo size={16} weight="fill" /> YouTube
                </span>
                <span className="chip">
                  <TwitchLogo size={16} weight="fill" /> Twitch
                </span>
                <span className="chip">Kick</span>
                <span className="chip">
                  <Globe size={16} /> 1,000+ sites
                </span>
                <span className="chip">
                  <CloudArrowUp size={16} /> Your files
                </span>
              </div>
              <div className={styles.part} aria-hidden="true">
                <span>Import only</span>
                <b>1:02:10</b>
                <span>to</span>
                <b>1:14:00</b>
              </div>
            </article>

            <article className={`${styles.cell} ${styles.cellFind}`}>
              <h3 className="t-heading-md">AI finds the moments</h3>
              <p>Each clip gets a score, a title and the reason it was picked, best first. Want more? Find more, in the length you choose.</p>
              <ol className={styles.picks} aria-label="Example clips">
                <li>
                  <span>The clutch nobody saw coming</span>
                  <b>
                    <AiMark size={12} /> 94
                  </b>
                </li>
                <li>
                  <span>Why I quit my job to stream</span>
                  <b>88</b>
                </li>
                <li>
                  <span>Chat roasts my setup</span>
                  <b>81</b>
                </li>
              </ol>
            </article>

            <article className={`${styles.cell} ${styles.cellTrim}`}>
              <h3 className="t-heading-md">Trim and reframe</h3>
              <p>Drag the ends to the frame, slide the picture to keep the subject in shot, and pick 9:16, 1:1 or 16:9.</p>
              <div className={styles.miniTrim} aria-hidden="true">
                <span className={styles.miniShade} style={{ left: 0, width: "24%" }} />
                <span className={styles.miniRange} style={{ left: "24%", width: "46%" }} />
                <span className={styles.miniShade} style={{ left: "70%", right: 0 }} />
                <i className={styles.miniHead} />
              </div>
            </article>

            <article className={`${styles.cell} ${styles.cellExport}`}>
              <h3 className="t-heading-md">Export and post</h3>
              <p>A 1080 x 1920 MP4 with the captions burned in, ready for TikTok, Shorts and Reels.</p>
              <div className={styles.exportRow} aria-hidden="true">
                <span className="btn btn-primary btn-sm">
                  <DownloadSimple size={16} /> Download MP4
                </span>
                <span className="badge is-success">
                  <Check size={14} /> 1080p, captions on
                </span>
              </div>
            </article>
          </div>
        </section>

        <section id="captions" className={`container ${styles.section}`} aria-labelledby="captions-title">
          <div className={`${styles.head} reveal`}>
            <h2 id="captions-title" className="t-display-lg">
              captions people <span className="hl">actually read.</span>
            </h2>
            <p className={styles.sub}>Each word lights up as it’s said. Pick a style, fix a word, and the export looks just like the preview.</p>
          </div>
          <div className="reveal">
            <CaptionStudio />
          </div>
        </section>

        <section id="languages" className={`container ${styles.section}`} aria-labelledby="languages-title">
          <div className={`${styles.head} reveal`}>
            <h2 id="languages-title" className="t-display-lg">
              any language, <span className="hl">even live.</span>
            </h2>
          </div>
          <div className={`${styles.features} reveal`}>
            <article className={styles.feature}>
              <LanguageCard />
              <h3 className="t-heading-md">Every language, detected</h3>
              <p>Spanish, Chinese, Japanese, Korean, Portuguese and 100 more, detected for you. Mixed with English? Each part is written in its own script.</p>
            </article>
            <article className={styles.feature}>
              <LiveCard />
              <h3 className="t-heading-md">Clip live streams</h3>
              <p>Paste a live Twitch, YouTube or Kick link. Bamio follows the stream, so you can clip while it’s still on.</p>
            </article>
          </div>
        </section>

        <section id="faq" className={`container ${styles.section} ${styles.faq}`} aria-labelledby="faq-title">
          <h2 id="faq-title" className="t-display-lg reveal">
            questions, <span className="hl">answered.</span>
          </h2>
          <FaqList items={FAQ} name="faq" className="reveal" />
        </section>

        <section id="get-started" className={`container ${styles.section}`} aria-labelledby="cta-title">
          <div className={`${styles.cta} reveal`}>
            <h2 id="cta-title" className="t-display-lg">
              your best moment is already recorded.
            </h2>
            <LinkForm variant="panel" />
          </div>
        </section>
      </main>

      <SiteFooter links={LINKS} roomForBar credit="Demo footage: Mixkit stock video." />

      <StickyLinkBar after="hero-link" until="get-started" />
      <JsonLd data={[ORGANIZATION, WEBSITE, softwareData(), faqData(faqPlain(FAQ))]} />
    </>
  );
}
