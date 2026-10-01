#!/usr/bin/env node
/*
 * Makes the landing page's demo footage in public/landing/ from two Mixkit stock videos
 * (Stock Video Free License: free for commercial use, no credit required):
 *   2948  "People recording a podcast in a studio"  -> podcast
 *   43526 "Man playing an online video game on his computer" (a face cam) -> stream
 * For each: a silent 960x540 loop (WebM VP9 and MP4 H.264; it cuts straight back to the start,
 * since a dissolve between two moments of people talking shows them twice), stills of it (WebP),
 * and for the podcast a 10-frame filmstrip. Footage Bamio shows must be
 * licensed for it: no clips of real creators without their permission.
 *   node scripts/landing-footage.mjs
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

const ff = (...args) => execFileSync(ffmpegPath, ["-v", "error", "-y", ...args], { stdio: "inherit" });

for (const f of FOOTAGE) {
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
