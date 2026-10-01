import "server-only";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import { isAbortError, ProcessError, run } from "@/lib/server/bin";

/*
 * Downloading just a part of a video whose files are fragmented MP4 with an index (a sidx
 * box, as YouTube's H.264 and AAC files are): the index says where every fragment of a few
 * seconds starts and how big it is, so only the file's header and the fragments covering
 * the part are fetched, in ranged requests of 8 MB, four at a time. YouTube serves those at
 * full speed; reading a part through ffmpeg over one connection runs at about 2x real time.
 */

export type Fragment = { start: number; duration: number; offset: number; size: number };
type Remote = { url: string; headers: Record<string, string> };

/** Top-level boxes of an MP4 prefix: type, where each starts, and its size. */
function boxes(buf: Buffer): { type: string; start: number; size: number }[] {
  const out: { type: string; start: number; size: number }[] = [];
  let at = 0;
  while (at + 8 <= buf.length) {
    let size = buf.readUInt32BE(at);
    const type = buf.toString("latin1", at + 4, at + 8);
    if (size === 1) {
      if (at + 16 > buf.length) break;
      size = Number(buf.readBigUInt64BE(at + 8));
    } else if (size === 0) break;
    if (size < 8) break;
    out.push({ type, start: at, size });
    at += size;
  }
  return out;
}

/**
 * The fragments a sidx box lists (times in seconds), given the box and where it starts in
 * the file. Null when it isn't a plain index of media fragments.
 */
export function parseSidx(box: Buffer, boxStart: number): Fragment[] | null {
  const version = box.readUInt8(8);
  const timescale = box.readUInt32BE(16);
  let at = 20;
  let time: number;
  let firstOffset: number;
  if (version === 0) {
    time = box.readUInt32BE(at);
    firstOffset = box.readUInt32BE(at + 4);
    at += 8;
  } else {
    time = Number(box.readBigUInt64BE(at));
    firstOffset = Number(box.readBigUInt64BE(at + 8));
    at += 16;
  }
  const count = box.readUInt16BE(at + 2);
  at += 4;
  if (!timescale || at + count * 12 > box.length) return null;
  let offset = boxStart + box.length + firstOffset;
  const fragments: Fragment[] = [];
  for (let i = 0; i < count; i++, at += 12) {
    const ref = box.readUInt32BE(at);
    if (ref >>> 31) return null; // points at another index, not media
    const size = ref & 0x7fffffff;
    const duration = box.readUInt32BE(at + 4);
    fragments.push({ start: time / timescale, duration: duration / timescale, offset, size });
    time += duration;
    offset += size;
  }
  return fragments;
}

async function fetchRange(f: Remote, from: number, to: number, signal?: AbortSignal): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(f.url, { headers: { ...f.headers, Range: `bytes=${from}-${to}` }, signal });
      if (res.status !== 206) {
        const body = (await res.text().catch(() => "")).slice(0, 200);
        throw Object.assign(new Error(`range ${from}-${to} answered ${res.status} ${body}`), { fatal: res.status !== 200 && res.status < 500 });
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length !== to - from + 1) throw new Error("short range answer");
      return buf;
    } catch (err) {
      if (signal?.aborted || (err as { fatal?: boolean }).fatal || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

/** A file's header (everything before its index) and its fragments, from its first 256 KB. */
async function readIndex(f: Remote, signal?: AbortSignal): Promise<{ header: number; fragments: Fragment[] } | null> {
  const head = await fetchRange(f, 0, 256 * 1024 - 1, signal).catch((err: unknown) => {
    if (signal?.aborted) throw err;
    return null;
  });
  if (!head) return null;
  const list = boxes(head);
  const sidx = list.find((b) => b.type === "sidx");
  if (!list.some((b) => b.type === "moov") || !sidx || sidx.start + sidx.size > head.length) return null;
  const fragments = parseSidx(head.subarray(sidx.start, sidx.start + sidx.size), sidx.start);
  return fragments?.length ? { header: sidx.start, fragments } : null;
}

/** The header and the fragments covering [start, end), downloaded into `file` as one playable fragmented MP4. */
async function downloadPart(f: Remote, index: { header: number; fragments: Fragment[] }, start: number, end: number, file: string, onBytes: (n: number) => void, signal?: AbortSignal) {
  const chosen = index.fragments.filter((x) => x.start < end && x.start + x.duration > start);
  if (chosen.length === 0) throw new Error("no fragments in that part");
  const from = chosen[0]!.offset;
  const to = chosen.at(-1)!.offset + chosen.at(-1)!.size; // exclusive
  const pieces: { src: number; dst: number; length: number }[] = [{ src: 0, dst: 0, length: index.header }];
  for (let at = from; at < to; at += 8 * 1024 * 1024) pieces.push({ src: at, dst: index.header + (at - from), length: Math.min(8 * 1024 * 1024, to - at) });
  const handle = await open(file, "w");
  try {
    let next = 0;
    const lane = async () => {
      while (next < pieces.length) {
        const p = pieces[next++]!;
        const buf = await fetchRange(f, p.src, p.src + p.length - 1, signal);
        await handle.write(buf, 0, buf.length, p.dst);
        onBytes(buf.length);
      }
    };
    await Promise.all([lane(), lane(), lane(), lane()]);
  } finally {
    await handle.close();
  }
  return { start: chosen[0]!.start, end: chosen.at(-1)!.start + chosen.at(-1)!.duration, bytes: to - from + index.header };
}

/**
 * Download [start, end) of a video given as separate video and audio files (or one file)
 * with an index, into `dir`/part.mp4. Null when the files have no usable index, so the
 * caller can fall back to another way.
 */
export async function downloadIndexedPart(
  files: Remote[],
  range: { start: number; end: number },
  dir: string,
  opts: { signal?: AbortSignal; onProgress?: (p: number) => void },
): Promise<string | null> {
  const indexes = await Promise.all(files.map((f) => readIndex(f, opts.signal)));
  if (indexes.some((i) => !i)) return null;
  const total = indexes.reduce((sum, idx) => {
    const chosen = idx!.fragments.filter((x) => x.start < range.end && x.start + x.duration > range.start);
    return sum + chosen.reduce((a, x) => a + x.size, 0);
  }, 0);
  let done = 0;
  const onBytes = (n: number) => {
    done += n;
    opts.onProgress?.(Math.min(0.95, (done / Math.max(1, total)) * 0.95));
  };
  const parts = files.map((_, i) => path.join(dir, `part-${i}.mp4`));
  try {
    const got = await Promise.all(files.map((f, i) => downloadPart(f, indexes[i]!, range.start, range.end, parts[i]!, onBytes, opts.signal)));
    // One MP4. The video and audio fragments start at slightly different moments, so their
    // original times are kept (-copyts, in step) and both shifted by the same amount to start at 0.
    const first = Math.min(...got.map((g) => g.start));
    const out = path.join(dir, "part.mp4");
    await run(
      "ffmpeg",
      [
        ...["-hide_banner", "-nostdin", "-y", ...parts.flatMap((p) => ["-i", p]), "-copyts", "-output_ts_offset", (-first).toFixed(6)],
        ...(parts.length > 1 ? ["-map", "0:v:0", "-map", "1:a:0"] : ["-map", "0:v:0", "-map", "0:a:0?"]),
        ...["-c", "copy", out],
      ],
      { signal: opts.signal, timeoutMs: 30 * 60 * 1000 },
    );
    return out;
  } catch (err) {
    if (isAbortError(err) || opts.signal?.aborted) throw err;
    console.error("[bamio/media] fetching the part by its index failed:", err instanceof ProcessError ? err.stderrTail.slice(-800) : err);
    return null;
  } finally {
    await Promise.all(parts.map((p) => rm(p, { force: true })));
  }
}
