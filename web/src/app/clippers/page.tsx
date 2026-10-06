import type { Icon } from "@phosphor-icons/react";
import { ArrowUpRight, Broadcast, InstagramLogo, TiktokLogo, TwitchLogo, XLogo, YoutubeLogo } from "@phosphor-icons/react/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { SITE_LINKS } from "@/components/site/use-case";
import { CLIPPER_PLATFORMS, type ClipperCard, type ClipperPlatform } from "@/lib/profile/clipper";
import { listClippers } from "@/lib/server/clippers";
import { pageMetadata } from "@/lib/site";
import styles from "./clippers.module.css";

const title = "Clippers: people who clip with Bamio";
const description = "Meet the clippers who turn streams, podcasts and long videos into shorts with Bamio, and find one for your channel. Clip with Bamio? Add yourself.";

export const metadata: Metadata = pageMetadata({ title, description, path: "/clippers", absoluteTitle: true });

const ICONS: Record<ClipperPlatform, Icon> = { youtube: YoutubeLogo, twitch: TwitchLogo, kick: Broadcast, tiktok: TiktokLogo, instagram: InstagramLogo, x: XLogo };

/**
 * The Clippers page: users who chose to be shown (Profile, Clippers page) and were approved by
 * an admin, those with the most exported clips first. Read from the database at request time
 * (src/lib/server/clippers.ts keeps the list a minute).
 */
export default async function ClippersPage() {
  await connection();
  const clippers = await listClippers().catch(() => null);

  return (
    <>
      <SiteHeader links={SITE_LINKS} current="/clippers" />
      <main id="main">
        <section className={`container ${styles.hero}`} aria-labelledby="clippers-title">
          <h1 id="clippers-title" className="t-display-xl">
            meet the <span className="hl">clippers.</span>
          </h1>
          <p className={styles.lede}>The people turning streams, podcasts and long videos into shorts with Bamio. Looking for someone to clip your channel? Start here.</p>
          <Link href="/profile/clippers" className="btn btn-primary btn-lg">
            Add yourself
          </Link>
        </section>

        <section className={`container ${styles.wall}`} aria-label="Clippers">
          {clippers === null ? (
            <div className="empty" role="alert">
              <h2 className="empty-title">The clippers couldn’t be loaded</h2>
              <p className="empty-body">Something went wrong on our side. Try again in a moment.</p>
            </div>
          ) : clippers.length === 0 ? (
            <div className="empty">
              <span className="ai-mark" aria-hidden />
              <h2 className="empty-title">The first clippers are on their way</h2>
              <p className="empty-body">Clip with Bamio? Turn on “Show me on the Clippers page” in your profile, and your card goes up once we’ve had a look.</p>
            </div>
          ) : (
            <ul className={styles.grid}>
              {clippers.map((c, i) => (
                <Card key={`${i}-${c.name}`} clipper={c} />
              ))}
            </ul>
          )}
        </section>
      </main>
      <SiteFooter links={SITE_LINKS} />
    </>
  );
}

function Card({ clipper }: { clipper: ClipperCard }) {
  const PlatformIcon = clipper.link ? ICONS[clipper.link.platform] : null;
  return (
    <li className={styles.card}>
      <div className={styles.who}>
        <span className={`avatar avatar-lg ${styles.avatar}`} aria-hidden="true">
          {/* Their Clerk profile picture (a remote file whose size isn't known here). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {clipper.imageUrl ? <img src={clipper.imageUrl} alt="" width={56} height={56} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : clipper.name.slice(0, 1).toUpperCase()}
        </span>
        <div className={styles.id}>
          <h2 className={styles.name}>{clipper.name}</h2>
          <p className={styles.count}>{clipper.clips > 0 ? `${clipper.clips.toLocaleString("en-US")} ${clipper.clips === 1 ? "clip" : "clips"} made with Bamio` : "New on Bamio"}</p>
        </div>
      </div>
      {clipper.bio ? <p className={styles.bio}>{clipper.bio}</p> : null}
      {clipper.link && PlatformIcon ? (
        // A link a user gave: search engines are told not to count it, and it opens apart from Bamio.
        <a className={styles.channel} href={clipper.link.url} target="_blank" rel="nofollow ugc noopener noreferrer">
          <PlatformIcon size={18} weight="fill" aria-hidden />
          <span className={styles.handle}>{clipper.link.handle}</span>
          <span className="sr-only">
            : {clipper.name} on {CLIPPER_PLATFORMS[clipper.link.platform].name} (opens in a new tab)
          </span>
          <ArrowUpRight size={16} aria-hidden />
        </a>
      ) : null}
    </li>
  );
}
