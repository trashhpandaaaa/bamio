#!/usr/bin/env node
/*
 * Makes the landing page's demo footage in public/landing/ from Mixkit stock videos
 * (Stock Video Free License: free for commercial use, no credit required):
 *   2948  "People recording a podcast in a studio"  -> podcast
 *   43526 "Man playing an online video game on his computer" (a face cam) -> stream
 * For each: a silent 960x540 loop (WebM VP9 and MP4 H.264; it cuts straight back to the start,
 * since a dissolve between two moments of people talking shows them twice), stills of it (WebP),
 * and for the podcast a 10-frame filmstrip.
 * And the gaming clip reel (components/landing/clip-reel.tsx): six gaming moments, each a silent
 * 360x640 vertical loop cropped the way Bamio reframes (REEL below), and its first frame as a
 * still. None shows a game people would recognise: a famous game on screen brings its maker's
 * trademark along. Footage Bamio shows must be licensed for it: no clips of real creators
 * without their permission.
 *   node scripts/landing-footage.mjs            everything
 *   node scripts/landing-footage.mjs reel       only the reel (or: podcast, stream)
 * The 720p originals are kept in qa/footage-src/ (gitignored).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = path.join(root, "qa", "footage-src");
const out = path.join(root, "public", "landing");
mkdirSync(src, { recursive: true });
mkdirSync(out, { recursive: true });

const FOOTAGE = [
  // name, Mixkit id, the part looped (seconds), stills (seconds into the loop)
  { name: "podcast", id: 2948, from: 0, to: 10.1, stills: [0, 3, 6], strip: true },
  { name: "stream", id: 43526, from: 0, to: 9.6, stills: [0] },
];

/** Mixkit's CDN stalls on whole-file requests from some networks; 1 MB ranges come through. */
async function download(id) {
  const file = path.join(src, `${id}-720.mp4`);
  const url = `https://assets.mixkit.co/videos/${id}/${id}-720.mp4`;
  const head = await fetch(url, { method: "HEAD" });
  const size = Number(head.headers.get("content-length"));
  if (!head.ok || !size) throw new Error(`Mixkit ${id}: ${head.status}`);
  if (existsSync(file) && statSync(file).size === size) return file;
  writeFileSync(file, "");
  for (let at = 0; at < size; ) {
    let chunk;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url, { headers: { Range: `bytes=${at}-${Math.min(size, at + 1048576) - 1}` }, signal: AbortSignal.timeout(30_000) });
        if (res.status !== 206) throw new Error(`HTTP ${res.status}`);
        chunk = Buffer.from(await res.arrayBuffer());
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
      }
    }
    appendFileSync(file, chunk);
    at += chunk.length;
  }
  return file;
}

/**
 * The reel: name, Mixkit id, the part looped (seconds) and where the 9:16 crop is centred
 * (0 = the frame's left edge, 1 = its right edge), chosen so the face or the screen stays in
 * frame for the whole loop.
 */
const REEL = [
  { name: "reel-clutch", id: 51612, from: 2.5, to: 10.5, focus: 0.55 }, // celebrates, arms up
  { name: "reel-shooter", id: 5444, from: 1, to: 9, focus: 0.36 }, // over the shoulder: a sci-fi shooter on screen
  { name: "reel-hype", id: 45814, from: 0.4, to: 7.6, focus: 0.47 }, // focused, then shouts
  // A fine neon grid and stars: compressed harder, or it alone outweighs the other five.
  { name: "reel-racer", id: 5399, from: 0, to: 6, focus: 0.5, crf: { h264: 33, vp9: 48 } }, // a neon racing flythrough
  { name: "reel-rage", id: 45735, from: 0.3, to: 7, focus: 0.52 }, // yells at the screen (and leans right)
  { name: "reel-vr", id: 40464, from: 5.5, to: 13.5, vertical: true, crf: { h264: 30, vp9: 42 } }, // a VR game, dancing to dodge (filmed vertical: no crop)
];

const ff = (...args) => execFileSync(ffmpegPath, ["-v", "error", "-y", ...args], { stdio: "inherit" });
const only = process.argv.slice(2);
const wanted = (name) => only.length === 0 || only.some((o) => name === o || name.startsWith(`${o}-`));

for (const f of FOOTAGE) {
  if (!wanted(f.name)) continue;
  const input = await download(f.id);
  const len = f.to - f.from;
  const graph = `[0:v]trim=${f.from}:${f.to},setpts=PTS-STARTPTS,scale=960:540:flags=lanczos,format=yuv420p[v]`;
  const mp4 = path.join(out, `${f.name}.mp4`);
  ff("-i", input, "-filter_complex", graph, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "25", "-profile:v", "high", "-movflags", "+faststart", mp4);
  ff("-i", input, "-filter_complex", graph, "-map", "[v]", "-an", "-c:v", "libvpx-vp9", "-crf", "36", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", path.join(out, `${f.name}.webm`));
  for (const at of f.stills) ff("-ss", String(at), "-i", mp4, "-frames:v", "1", "-c:v", "libwebp", "-quality", "78", path.join(out, `${f.name}-${at}.webp`));
  if (f.strip) ff("-i", mp4, "-vf", `fps=10/${len},scale=192:108:flags=lanczos,tile=10x1`, "-frames:v", "1", "-c:v", "libwebp", "-quality", "75", path.join(out, `${f.name}-strip.webp`));
  console.log(`✓ ${f.name} (Mixkit ${f.id})`);
}

for (const f of REEL) {
  if (!wanted(f.name)) continue;
  const input = await download(f.id);
  // A 9:16 window of the 1280x720 frame: 405 wide, kept inside it, then 360x640 (a vertical video as it is).
  const x = Math.round(Math.min(1280 - 405, Math.max(0, (f.focus ?? 0.5) * 1280 - 202.5)));
  const frame = f.vertical ? "" : `crop=405:720:${x}:0,`;
  const graph = `[0:v]trim=${f.from}:${f.to},setpts=PTS-STARTPTS,${frame}scale=360:640:flags=lanczos,format=yuv420p[v]`;
  const mp4 = path.join(out, `${f.name}.mp4`);
  ff("-i", input, "-filter_complex", graph, "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "slow", "-crf", String(f.crf?.h264 ?? 27), "-profile:v", "high", "-movflags", "+faststart", mp4);
  ff("-i", input, "-filter_complex", graph, "-map", "[v]", "-an", "-c:v", "libvpx-vp9", "-crf", String(f.crf?.vp9 ?? 38), "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "2", path.join(out, `${f.name}.webm`));
  ff("-i", mp4, "-frames:v", "1", "-c:v", "libwebp", "-quality", "76", path.join(out, `${f.name}-0.webp`));
  console.log(`✓ ${f.name} (Mixkit ${f.id})`);
}
