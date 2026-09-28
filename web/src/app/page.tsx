import { Show } from "@clerk/nextjs";
import { ArrowRight, Broadcast, Check, DownloadSimple, Globe, LinkSimple, TwitchLogo, YoutubeLogo } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { AiMark, Wordmark } from "@/components/brand";
import { CaptionDemo } from "@/components/caption-demo";
import styles from "./page.module.css";

export default function Home() {
  return (
    <>
      <header className={styles.top}>
        <div className={`container ${styles.topInner}`}>
          <Wordmark />
          <nav className={styles.topNav} aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#captions">Captions</a>
            <Show when="signed-in">
              <Link href="/projects">Your projects</Link>
            </Show>
          </nav>
          <div className={styles.topAuth}>
            <AuthControls />
          </div>
        </div>
      </header>

      <main id="main">
        <section className={`container ${styles.hero}`}>
          <div className={styles.heroCopy}>
            <h1 className="t-display-2xl">
              clip the moments that <span className="hl">hook.</span>
            </h1>
            <p className={styles.lede}>
              Paste a YouTube, Twitch or Kick link, or upload a video. Bamio finds the best moments, frames them vertical and captions them word by word.
            </p>
            <div className={styles.ctas}>
              <Link href="/new" className="btn btn-volt btn-lg">
                Start clipping
                <ArrowRight size={18} weight="bold" aria-hidden />
              </Link>
              <a href="#how" className="btn btn-ghost btn-lg">
                See how it works
              </a>
            </div>
            <ul className={styles.sources} aria-label="Works with">
              <li>
                <YoutubeLogo size={18} weight="fill" aria-hidden /> YouTube
              </li>
              <li>
                <TwitchLogo size={18} weight="fill" aria-hidden /> Twitch
              </li>
              <li>
                <Broadcast size={18} weight="bold" aria-hidden /> Kick
              </li>
              <li>
                <Globe size={18} aria-hidden /> 1,000+ more sites, or your own files
              </li>
            </ul>
          </div>
          <CaptionDemo />
        </section>

        <section id="how" className={`container ${styles.section}`} aria-labelledby="how-title">
          <h2 id="how-title" className="t-display-lg">
            long video in, <span className="hl">shorts out.</span>
          </h2>
          <div className={styles.bento}>
            <article className={`${styles.cell} ${styles.cellLink}`}>
              <h3 className="t-heading-md">Paste a link</h3>
              <p>Streams, VODs, podcasts and uploads up to 3 hours. Only need part of a long stream? Import just that part.</p>
              <div className={styles.fakeInput} aria-hidden="true">
                <LinkSimple size={18} />
                <span>twitch.tv/videos/2193…</span>
                <span className="btn btn-volt btn-sm">Import</span>
              </div>
            </article>

            <article className={`${styles.cell} ${styles.cellFind}`}>
              <h3 className="t-heading-md">AI finds the moments</h3>
              <p>Bamio transcribes the video and picks the parts that stand on their own, with a hook up front and a payoff at the end.</p>
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
          <h2 id="captions-title" className="t-display-lg">
            captions people <span className="hl">actually read.</span>
          </h2>
          <ul className={styles.styles} aria-label="Caption styles">
            <li>
              <div className={`${styles.sample} ${styles.samplePop}`} aria-hidden="true">
                <p>
                  wait for <span>it</span>
                </p>
              </div>
              <h3 className="t-heading-sm">Pop</h3>
              <p>Big words, revealed as they’re spoken, with the current word in volt.</p>
            </li>
            <li>
              <div className={`${styles.sample} ${styles.sampleClean}`} aria-hidden="true">
                <p>and that’s when I knew it would work</p>
              </div>
              <h3 className="t-heading-sm">Clean</h3>
              <p>One tidy line of subtitles for talks, interviews and podcasts.</p>
            </li>
            <li>
              <div className={`${styles.sample} ${styles.sampleBoxed}`} aria-hidden="true">
                <p>
                  <span>three things I wish I knew</span>
                </p>
              </div>
              <h3 className="t-heading-sm">Boxed</h3>
              <p>White text on dark boxes that stays legible over busy footage.</p>
            </li>
          </ul>
        </section>

        <section className={`container ${styles.section}`} aria-labelledby="cta-title">
          <div className={styles.cta}>
            <h2 id="cta-title" className="t-display-lg">
              your best moment is already recorded.
            </h2>
            <Link href="/new" className="btn btn-primary btn-lg">
              Start clipping
              <ArrowRight size={18} weight="bold" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className={`container ${styles.footer}`}>
        <Wordmark size={22} />
        <p>Only clip videos you own or have permission to use. Transcripts and clip picks by Google Gemini.</p>
      </footer>
    </>
  );
}
