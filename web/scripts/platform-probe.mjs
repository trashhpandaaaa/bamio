/*
 * Which sites can Bamio read right now? Asks yt-dlp about one public video on each, the way
 * inspectUrl does, and says what came back (or why not). Sites change often: run it when
 * someone reports a link that won't import, and after updating yt-dlp (npm run setup:media).
 * A site that fails here and on the server may still work from one of them only (some turn
 * away data centres), so run it on the Droplet too.
 *
 *   node scripts/platform-probe.mjs            every site in the list
 *   node scripts/platform-probe.mjs vimeo ted  only these
 */
import { spawn } from "node:child_process";
import path from "node:path";

const ytdlp = path.join(process.cwd(), ".bin", process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp");
const SITES = {
  youtube: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  "youtube-short": "https://www.youtube.com/shorts/jNQXAC9IVRw",
  vimeo: "https://vimeo.com/22439234",
  // What Bamio asks instead of the page (playerUrl): the page answers only signed-in browsers.
  "vimeo-player": "https://player.vimeo.com/video/22439234",
  dailymotion: "https://www.dailymotion.com/video/x8tubcu",
  ted: "https://www.ted.com/talks/ken_robinson_do_schools_kill_creativity",
  tiktok: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
  facebook: "https://www.facebook.com/facebook/videos/10153231379946729/",
  streamable: "https://streamable.com/moo",
  bilibili: "https://www.bilibili.com/video/BV1GJ411x7h7",
  archive: "https://archive.org/details/BigBuckBunny_124",
  "direct-mp4": "https://download.samplelib.com/mp4/sample-5s.mp4",
  soundcloud: "https://soundcloud.com/forss/flickermood",
  rumble: "https://rumble.com/v4ntw2r-big-buck-bunny.html",
  reddit: "https://www.reddit.com/r/videos/comments/6rrwyj/that_small_heart_attack/",
  twitch: "https://www.twitch.tv/videos/6528877",
};

function ask(url) {
  return new Promise((resolve) => {
    const child = spawn(ytdlp, ["--no-playlist", "--no-warnings", "--ignore-config", "--js-runtimes", `node:${process.execPath}`, "-J", "--skip-download", "--", url], { windowsHide: true });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err = (err + d).slice(-600)));
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const info = JSON.parse(out);
        // Sound only when every format says so (a direct file link doesn't say what's in it).
        const formats = info.formats ?? [];
        const soundOnly = formats.length > 0 && formats.every((f) => f.vcodec === "none");
        const length = info.duration > 0 ? `${String(Math.round(info.duration)).padStart(5)} s` : " no length";
        resolve(`ok   ${String(info.extractor).padEnd(14)} ${length}  ${soundOnly ? "SOUND ONLY  " : ""}${info.is_live ? "live  " : ""}${String(info.title).slice(0, 40)}`);
      } catch {
        resolve(`FAIL ${err.split("\n").filter(Boolean).at(-1)?.slice(0, 150) ?? "no answer"}`);
      }
    });
  });
}

const wanted = process.argv.slice(2);
for (const [name, url] of Object.entries(SITES)) {
  if (wanted.length && !wanted.includes(name)) continue;
  console.log(`${name.padEnd(14)} ${await ask(url)}`);
}
