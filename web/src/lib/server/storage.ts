import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  NotFound,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { serveFile } from "@/lib/server/files";
import { HttpError } from "@/lib/server/http";

/*
 * Where projects' media live (source videos, thumbnails, frames, exports, uploads, a followed
 * stream's segments), under keys like "users/<user>/projects/<project>/source.mp4":
 *   local  files under BAMIO_DATA_DIR (or web/.data), the key as the path. One server, or
 *          several sharing that folder. The default without S3 settings.
 *   s3     any S3-compatible store (AWS S3, Cloudflare R2, MinIO): S3_BUCKET, S3_REGION,
 *          S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY. Browsers get short-lived
 *          signed links; ffmpeg reads them too. S3_PUBLIC_ENDPOINT: where browsers reach the
 *          store when it differs from S3_ENDPOINT (MinIO in Docker Compose: minio:9000 inside,
 *          localhost:9000 outside); links are signed for that host.
 * STORAGE_DRIVER=local|s3 picks one explicitly.
 */

export type StoredObject = { size: number };
export type UploadedPart = { n: number; etag: string };

export interface Storage {
  readonly name: "local" | "s3";
  /** Something ffmpeg and ffprobe can read: a local path, or a signed https link. */
  readable(key: string): Promise<string>;
  /** Store a local file at `key`: moved into place (local) or uploaded and then removed; with `keep`, copied. Returns its size. */
  publish(key: string, file: string, contentType: string, opts?: { keep?: boolean }): Promise<number>;
  /** Copy the object into a local file. */
  download(key: string, file: string): Promise<void>;
  readText(key: string): Promise<string | null>;
  stat(key: string): Promise<StoredObject | null>;
  remove(key: string): Promise<void>;
  removePrefix(prefix: string): Promise<void>;
  /**
   * Answer a browser's request for the object: streamed with Range support (local), or a
   * redirect to a signed link (s3). `proxy`: stream it through this server even on s3 (for
   * HLS, which the player fetches with XHR and would need CORS for elsewhere).
   */
  serve(req: Request, key: string, opts: { type: string; downloadName?: string; maxAge?: number; proxy?: boolean }): Promise<Response>;
  /** Uploads in numbered parts (all but the last at least 5 MB on s3), in order or retried. */
  startUpload(key: string): Promise<string>;
  uploadPart(key: string, uploadId: string, n: number, offset: number, body: Buffer): Promise<string>;
  finishUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
  abortUpload(key: string, uploadId: string): Promise<void>;
  /** local only: the file for a key, for writers that must write in place (a followed stream's HLS). */
  localPath?(key: string): string;
}

const KEY = /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+$/;

function checkKey(key: string) {
  if (!KEY.test(key) || key.split("/").some((part) => part === "." || part === "..")) throw new HttpError(400, "bad_request", "Bad storage key.");
  return key;
}

/* ------------------------------ Local files ------------------------------ */

const dataRoot = () =>
  path.resolve(/*turbopackIgnore: true*/ process.env.BAMIO_DATA_DIR || path.join(/*turbopackIgnore: true*/ process.cwd(), ".data"));

/** Rename, or copy and delete when the scratch folder is on another drive. */
async function moveFile(from: string, to: string) {
  await mkdir(path.dirname(to), { recursive: true });
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EXDEV") {
        await copyFile(from, to);
        await rm(from, { force: true });
        return;
      }
      // Windows can refuse a rename while the file is being read; retry briefly.
      if (attempt >= 8 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}

class LocalStorage implements Storage {
  readonly name = "local" as const;
  localPath(key: string) {
    return path.join(dataRoot(), ...checkKey(key).split("/"));
  }
  async readable(key: string) {
    return this.localPath(key);
  }
  async publish(key: string, file: string, _contentType: string, opts: { keep?: boolean } = {}) {
    const to = this.localPath(key);
    if (path.resolve(file) !== to) {
      if (opts.keep) {
        await mkdir(path.dirname(to), { recursive: true });
        await copyFile(file, to);
      } else await moveFile(file, to);
    }
    return (await stat(to)).size;
  }
  async download(key: string, file: string) {
    await mkdir(path.dirname(file), { recursive: true });
    await copyFile(this.localPath(key), file);
  }
  async readText(key: string) {
    return readFile(this.localPath(key), "utf8").catch(() => null);
  }
  async stat(key: string) {
    const info = await stat(this.localPath(key)).catch(() => null);
    return info?.isFile() ? { size: info.size } : null;
  }
  async remove(key: string) {
    await rm(this.localPath(key), { force: true });
  }
  async removePrefix(prefix: string) {
    await rm(this.localPath(prefix), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  async serve(req: Request, key: string, opts: { type: string; downloadName?: string; maxAge?: number }) {
    return serveFile(req, this.localPath(key), opts);
  }
  async startUpload(key: string) {
    const file = this.localPath(key);
    await mkdir(path.dirname(file), { recursive: true });
    await (await open(file, "w")).close();
    return "local";
  }
  async uploadPart(key: string, _uploadId: string, _n: number, offset: number, body: Buffer) {
    const file = await open(this.localPath(key), "r+");
    try {
      await file.write(body, 0, body.length, offset);
    } finally {
      await file.close();
    }
    return "local";
  }
  async finishUpload() {}
  async abortUpload(key: string) {
    await this.remove(key);
  }
}

/* ------------------------------ S3 ------------------------------ */

/** Signed links last two hours and stay the same for an hour, so browsers can cache what they fetch. */
const LINK_SEC = 2 * 3600;
const signingDate = () => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);

const isMissing = (err: unknown) => err instanceof NoSuchKey || err instanceof NotFound || (err as { name?: string })?.name === "NotFound";

class S3Storage implements Storage {
  readonly name = "s3" as const;
  private readonly client: S3Client;
  /** Signs the links browsers get (S3_PUBLIC_ENDPOINT, else the same client). */
  private readonly browserClient: S3Client;
  constructor(private readonly bucket: string) {
    this.client = S3Storage.makeClient(process.env.S3_ENDPOINT);
    this.browserClient = process.env.S3_PUBLIC_ENDPOINT ? S3Storage.makeClient(process.env.S3_PUBLIC_ENDPOINT) : this.client;
  }
  private static makeClient(endpoint: string | undefined) {
    return new S3Client({
      region: process.env.S3_REGION || "auto",
      endpoint: endpoint || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "1",
      credentials:
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
          : undefined,
      // R2, MinIO and others don't all accept the SDK's newer default checksums.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  /** A signed link: for this server and its tools, or (`forBrowser`) for the browser. */
  private link(key: string, opts: { downloadName?: string; type?: string; forBrowser?: boolean } = {}) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: checkKey(key),
      ResponseContentDisposition: opts.downloadName ? `attachment; filename="${opts.downloadName}"` : undefined,
      ResponseContentType: opts.type,
    });
    return getSignedUrl(opts.forBrowser ? this.browserClient : this.client, command, { expiresIn: LINK_SEC, signingDate: signingDate() });
  }
  async readable(key: string) {
    return this.link(key);
  }
  async publish(key: string, file: string, contentType: string, opts: { keep?: boolean } = {}) {
    const size = (await stat(file)).size;
    await new Upload({ client: this.client, params: { Bucket: this.bucket, Key: checkKey(key), Body: createReadStream(file), ContentType: contentType }, partSize: 16 * 1024 * 1024 }).done();
    if (!opts.keep) await rm(file, { force: true });
    return size;
  }
  async download(key: string, file: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
    await mkdir(path.dirname(file), { recursive: true });
    await pipeline(res.Body as Readable, createWriteStream(file));
  }
  async readText(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
      return (await res.Body?.transformToString("utf-8")) ?? null;
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }
  async stat(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: checkKey(key) }));
      return { size: res.ContentLength ?? 0 };
    } catch (err) {
      if (isMissing(err)) return null;
      throw err;
    }
  }
  async remove(key: string) {
    await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: [{ Key: checkKey(key) }], Quiet: true } }));
  }
  async removePrefix(prefix: string) {
    const p = `${checkKey(prefix)}/`;
    let token: string | undefined;
    do {
      const list = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: p, ContinuationToken: token, MaxKeys: 1000 }));
      const keys = (list.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length > 0) await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }
  async serve(req: Request, key: string, opts: { type: string; downloadName?: string; maxAge?: number; proxy?: boolean }) {
    if (!opts.proxy) {
      if (!(await this.stat(key))) throw new HttpError(404, "not_found", "That file isn’t available.");
      return new Response(null, { status: 302, headers: { Location: await this.link(key, { ...opts, forBrowser: true }), "Cache-Control": "private, max-age=600" } });
    }
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: checkKey(key), Range: req.headers.get("range") ?? undefined }));
      const headers = new Headers({ "Content-Type": opts.type, "Cache-Control": `private, max-age=${opts.maxAge ?? 0}`, "Accept-Ranges": "bytes", "X-Content-Type-Options": "nosniff" });
      if (res.ContentLength !== undefined) headers.set("Content-Length", String(res.ContentLength));
      if (res.ContentRange) headers.set("Content-Range", res.ContentRange);
      if (res.ETag) headers.set("ETag", res.ETag);
      const body = res.Body ? (Readable.toWeb(res.Body as Readable) as ReadableStream<Uint8Array>) : null;
      return new Response(req.method === "HEAD" ? null : body, { status: res.ContentRange ? 206 : 200, headers });
    } catch (err) {
      if (isMissing(err)) throw new HttpError(404, "not_found", "That file isn’t available.");
      throw err;
    }
  }
  async startUpload(key: string) {
    const res = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: checkKey(key) }));
    if (!res.UploadId) throw new HttpError(502, "storage", "Couldn’t start the upload. Try again.");
    return res.UploadId;
  }
  async uploadPart(key: string, uploadId: string, n: number, _offset: number, body: Buffer) {
    const res = await this.client.send(new UploadPartCommand({ Bucket: this.bucket, Key: checkKey(key), UploadId: uploadId, PartNumber: n, Body: body, ContentLength: body.length }));
    if (!res.ETag) throw new HttpError(502, "storage", "Couldn’t store that part of the upload. Try again.");
    return res.ETag;
  }
  async finishUpload(key: string, uploadId: string, parts: UploadedPart[]) {
    const sorted = [...parts].sort((a, b) => a.n - b.n).map((p) => ({ PartNumber: p.n, ETag: p.etag }));
    await this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: checkKey(key), UploadId: uploadId, MultipartUpload: { Parts: sorted } }));
  }
  async abortUpload(key: string, uploadId: string) {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: checkKey(key), UploadId: uploadId })).catch(() => undefined);
  }
  /** Small objects written whole (a live playlist). */
  async putText(key: string, text: string, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: checkKey(key), Body: text, ContentType: contentType }));
  }
}

/* ------------------------------ Choice ------------------------------ */

type Cache = { config: string; storage: Storage };
const cache = globalThis as { __bamioStorage?: Cache };

/** The configured storage (one per process). */
export function storage(): Storage {
  const driver = process.env.STORAGE_DRIVER || (process.env.S3_BUCKET ? "s3" : "local");
  const config = `${driver}:${process.env.S3_BUCKET ?? ""}:${process.env.S3_ENDPOINT ?? ""}:${process.env.S3_PUBLIC_ENDPOINT ?? ""}:${process.env.BAMIO_DATA_DIR ?? ""}`;
  if (cache.__bamioStorage?.config !== config) {
    if (driver === "s3") {
      if (!process.env.S3_BUCKET) throw new Error("STORAGE_DRIVER=s3 needs S3_BUCKET.");
      cache.__bamioStorage = { config, storage: new S3Storage(process.env.S3_BUCKET) };
    } else if (driver === "local") {
      cache.__bamioStorage = { config, storage: new LocalStorage() };
    } else {
      throw new Error(`Unknown STORAGE_DRIVER "${driver}" (local or s3).`);
    }
  }
  return cache.__bamioStorage.storage;
}

/** Write text to `key` (s3: one put; local: in place). */
export async function putText(key: string, text: string, contentType: string) {
  const s = storage();
  if (s instanceof S3Storage) return s.putText(key, text, contentType);
  const file = s.localPath!(key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, text, "utf8");
}
