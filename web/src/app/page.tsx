import { Show } from "@clerk/nextjs";
import { ArrowRight, Check, Export, Paperclip } from "@phosphor-icons/react/ssr";
import Link from "next/link";
import { AuthControls } from "@/components/auth-controls";
import { AiMark, Wordmark } from "@/components/brand";
import { DemoPlayer } from "@/components/demo-player";
import styles from "./page.module.css";

export default function Home() {
  return (
    <>
      <header className={styles.top}>
        <div className={`container ${styles.topInner}`}>
          <Wordmark />
          <nav className={styles.topNav} aria-label="Main">
            <a href="#how">How it works</a>
            <Show when="signed-in">
              <Link href="/projects">Your videos</Link>
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
              make the <span className="hl">first second</span> count.
            </h1>
            <p className={styles.lede}>Bamio turns one idea into a finished vertical video. Hooks, script, voice-over and captions, directed by AI.</p>
            <div className={styles.ctas}>
              <Link href="/new" className="btn btn-volt btn-lg">
                Make a video
                <ArrowRight size={18} weight="bold" aria-hidden />
              </Link>
              <a href="#how" className="btn btn-ghost btn-lg">
                See how it works
              </a>
            </div>
          </div>
          <DemoPlayer />
        </section>

        <section id="how" className={`container ${styles.section}`} aria-labelledby="how-title">
          <h2 id="how-title" className="t-display-lg">
            idea to export, <span className="hl">in one place.</span>
          </h2>
          <div className={styles.bento}>
            <article className={`${styles.cell} ${styles.cellIdea}`}>
              <h3 className="t-heading-md">Drop in an idea</h3>
              <p>A sentence, a product link or a rough clip is enough to start.</p>
              <div className={styles.prompt} aria-hidden="true">
                <span>Our new cold brew, for people who hate mornings</span>
                <div className={styles.promptRow}>
                  <span className="chip is-selected">
                    <Check size={16} aria-hidden /> 30 sec
                  </span>
                  <span className="btn btn-ghost btn-icon btn-sm">
                    <Paperclip size={16} aria-hidden />
                  </span>
                  <span className="btn btn-volt btn-sm">Find the hook</span>
                </div>
              </div>
            </article>

            <article className={`${styles.cell} ${styles.cellHooks}`}>
              <h3 className="t-heading-md">Pick the hook</h3>
              <p>Bamio writes three openings with different angles. You choose, or write your own.</p>
              <ol className={styles.hooks} aria-label="Example hooks">
                <li className={styles.hookPicked}>
                  <AiMark size={14} /> Nobody tells you cold brew can taste like this
                </li>
                <li>I stopped making coffee at 6am. Here is why</li>
                <li>If mornings hate you back, watch this</li>
              </ol>
            </article>

            <article className={`${styles.cell} ${styles.cellEdit}`}>
              <h3 className="t-heading-md">Tune the cut</h3>
              <p>Every scene is editable: words, length, picture, voice. Captions follow the voice-over word by word.</p>
              <div className={styles.miniTimeline} aria-hidden="true">
                <span style={{ width: "22%" }} />
                <span style={{ width: "30%" }} className={styles.clipSelected} />
                <span style={{ width: "26%" }} />
                <span style={{ width: "18%" }} />
                <i className={styles.playhead} />
              </div>
            </article>

            <article className={`${styles.cell} ${styles.cellExport}`}>
              <h3 className="t-heading-md">Export and post</h3>
              <p>A 1080 x 1920 video file, rendered right in your browser.</p>
              <div className="row" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "auto" }} aria-hidden="true">
                <span className="btn btn-primary btn-sm">
                  <Export size={16} aria-hidden /> Export video
                </span>
                <span className="badge is-success">
                  <Check size={14} aria-hidden /> Ready to post
                </span>
              </div>
            </article>
          </div>
        </section>

        <section className={`container ${styles.section} ${styles.director}`} aria-labelledby="director-title">
          <div>
            <h2 id="director-title" className="t-display-lg">
              notes from your <span className="hl">AI director.</span>
            </h2>
            <p className={styles.lede}>Before you post, Bamio reviews the cut like a sharp creative director: the hook, the pacing, the captions. Apply a note in one click.</p>
          </div>
          <ul className={styles.notes} aria-label="Example director notes">
            <li>
              <span className="badge is-error">Fix</span>
              <strong>Your hook lands at second 3</strong>
              <p>Open on the pour, then say the line. Viewers decide in the first second.</p>
            </li>
            <li>
              <span className="badge is-warning">Improve</span>
              <strong>Scene 2 has 11 words for 2 seconds</strong>
              <p>Cut the caption to “colder, smoother, faster” so it reads in one glance.</p>
            </li>
            <li>
              <span className="badge">Polish</span>
              <strong>End on a reason to follow</strong>
              <p>Tell people what part two shows so the ask feels earned.</p>
            </li>
          </ul>
        </section>

        <section className={`container ${styles.section}`} aria-labelledby="cta-title">
          <div className={styles.cta}>
            <h2 id="cta-title" className="t-display-lg">
              your next video starts with one sentence.
            </h2>
            <Link href="/new" className="btn btn-primary btn-lg">
              Make a video
              <ArrowRight size={18} weight="bold" aria-hidden />
            </Link>
          </div>
        </section>
      </main>

      <footer className={`container ${styles.footer}`}>
        <Wordmark size={22} />
        <p>Your videos are saved in this browser, on this device. AI by Google Gemini.</p>
      </footer>
    </>
  );
}
