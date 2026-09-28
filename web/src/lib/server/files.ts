import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { HttpError } from "@/lib/server/http";

/**
 * Parse a single "bytes=a-b" range. Null means send the whole file (no header, or one
 * we choose to ignore such as a multi-range); "invalid" means 416 Range Not Satisfiable.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | "invalid" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    // Suffix range: the last N bytes.
    const n = Number(m[2]);
    if (n === 0) return "invalid";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return "invalid";
  return { start, end };
}

/** Stream a file with Range support (video seeking), ETag and optional download name. */
export async function serveFile(req: Request, file: string, opts: { type: string; downloadName?: string; maxAge?: number }): Promise<Response> {
  let size: number;
  let mtime: number;
  try {
    const info = await stat(file);
    size = info.size;
    mtime = info.mtimeMs;
  } catch {
    throw new HttpError(404, "not_found", "That file isn’t available.");
  }
  if (size === 0) throw new HttpError(404, "not_found", "That file isn’t available.");

  const etag = `"${size.toString(16)}-${Math.floor(mtime).toString(16)}"`;
  const headers = new Headers({
    "Content-Type": opts.type,
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Cache-Control": `private, max-age=${opts.maxAge ?? 0}`,
    "X-Content-Type-Options": "nosniff",
  });
  if (opts.downloadName) headers.set("Content-Disposition", `attachment; filename="${opts.downloadName}"`);
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const range = parseRange(req.headers.get("range"), size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  const status = range ? 206 : 200;
  if (req.method === "HEAD") return new Response(null, { status, headers });
  const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream<Uint8Array>;
  return new Response(body, { status, headers });
}
