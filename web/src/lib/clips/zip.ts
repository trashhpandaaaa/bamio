/*
 * A zip of a project's exports, written as it is sent: the files are read from storage one at
 * a time and go straight out to the browser, so a project of 60 clips never sits in memory.
 *
 * Nothing is compressed (method 0, "stored"): an MP4 is already compressed, and squeezing it
 * again would spend the server's CPU to save nothing. Sizes and checksums aren't known until
 * a file has been read, and a stream can't go back to fill them in, so each one is followed by
 * a data descriptor (the flag bit that says so is 0x08), which is how every zip tool writes a
 * stream. Names are UTF-8 (bit 0x800).
 *
 * Zip64 isn't written, so the whole archive must stay under 4 GB: `ZIP_MAX_BYTES`.
 */

export const ZIP_MAX_BYTES = 4 * 1024 ** 3 - 1;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

/** CRC-32 as zip wants it, fed a chunk at a time. */
export function crc32() {
  let crc = 0xffffffff;
  return {
    push(bytes: Uint8Array) {
      for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
    },
    get value() {
      return (crc ^ 0xffffffff) >>> 0;
    },
  };
}

export type ZipEntry = { name: string; bytes: () => AsyncIterable<Uint8Array> | ReadableStream<Uint8Array> };

/** A name a zip (and every operating system) accepts: no slashes, no control characters. */
export function zipName(name: string, fallback = "clip"): string {
  const clean = name
    .replace(/[\u0000-\u001f\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return clean || fallback;
}

/** The same name twice in one zip confuses the tools that open it: later ones get a number. */
export function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    const n = seen.get(name.toLowerCase()) ?? 0;
    seen.set(name.toLowerCase(), n + 1);
    return n === 0 ? name : `${stem} (${n})${ext}`;
  });
}

const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const bytes = (...parts: number[][]) => new Uint8Array(parts.flat());

/** MS-DOS date and time, which is all a zip header has room for. */
function dosTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear());
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  };
}

const FLAGS = 0x0008 | 0x0800;

/** A zip of these entries, as a stream. A file that can't be read stops the whole archive. */
export function zipStream(entries: ZipEntry[], now = new Date()): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const { time, date } = dosTime(now);
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (chunk: Uint8Array) => {
        controller.enqueue(chunk);
        offset += chunk.length;
      };
      try {
        for (const entry of entries) {
          const name = encoder.encode(entry.name);
          const at = offset;
          send(bytes(u32(0x04034b50), u16(20), u16(FLAGS), u16(0), u16(time), u16(date), u32(0), u32(0), u32(0), u16(name.length), u16(0)));
          send(name);
          const crc = crc32();
          let size = 0;
          const source = entry.bytes();
          const iterable: AsyncIterable<Uint8Array> =
            source instanceof ReadableStream ? (streamParts(source) as AsyncIterable<Uint8Array>) : source;
          for await (const chunk of iterable) {
            crc.push(chunk);
            size += chunk.length;
            send(chunk);
          }
          send(bytes(u32(0x08074b50), u32(crc.value), u32(size), u32(size)));
          central.push(
            bytes(
              u32(0x02014b50), u16(20), u16(20), u16(FLAGS), u16(0), u16(time), u16(date),
              u32(crc.value), u32(size), u32(size), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(at),
            ),
          );
          central.push(name);
          count++;
        }
        const directoryAt = offset;
        let directorySize = 0;
        for (const chunk of central) {
          controller.enqueue(chunk);
          directorySize += chunk.length;
        }
        controller.enqueue(bytes(u32(0x06054b50), u16(0), u16(0), u16(count), u16(count), u32(directorySize), u32(directoryAt), u16(0)));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

async function* streamParts(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
