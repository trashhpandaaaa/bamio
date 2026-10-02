import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { putText, storage } from "@/lib/server/storage";

/*
 * The same behaviour from both storage drivers: local files, and S3 (against s3rver, an S3
 * emulator, so the real protocol runs: signed links, ranges, multipart uploads).
 */

const require = createRequire(import.meta.url);
type S3rverServer = { run(): Promise<{ port: number }>; close(): Promise<void> };
const S3rver = require("s3rver") as new (opts: object) => S3rverServer;

const ENV = ["STORAGE_DRIVER", "S3_BUCKET", "S3_ENDPOINT", "S3_REGION", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "BAMIO_DATA_DIR"];

for (const driver of ["local", "s3"] as const) {
  describe(`${driver} storage`, () => {
    let dir: string;
    let server: S3rverServer | null = null;
    const saved: Record<string, string | undefined> = {};

    beforeAll(async () => {
      for (const k of ENV) saved[k] = process.env[k];
      dir = await mkdtemp(path.join(tmpdir(), `bamio-storage-${driver}-`));
      process.env.BAMIO_DATA_DIR = path.join(dir, "data");
      process.env.STORAGE_DRIVER = driver;
      if (driver === "s3") {
        server = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory: path.join(dir, "s3"), configureBuckets: [{ name: "bamio-test" }] });
        const { port } = await server.run();
        Object.assign(process.env, {
          S3_BUCKET: "bamio-test",
          S3_ENDPOINT: `http://127.0.0.1:${port}`,
          S3_REGION: "us-east-1",
          S3_FORCE_PATH_STYLE: "1",
          S3_ACCESS_KEY_ID: "S3RVER",
          S3_SECRET_ACCESS_KEY: "S3RVER",
        });
      }
    });
    afterAll(async () => {
      await server?.close();
      for (const k of ENV) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      await rm(dir, { recursive: true, force: true });
    });

    const local = async (name: string, content: string | Buffer) => {
      const file = path.join(dir, "scratch", name);
      await (await import("node:fs/promises")).mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
      return file;
    };
    /** What a browser gets for the object, following a redirect. */
    const fetchServed = async (res: Response, range?: string) => {
      if (res.status === 302) return fetch(res.headers.get("location")!, { headers: range ? { range } : {} });
      return res;
    };

    it("publishes a local file, then reads, stats and downloads it", async () => {
      const key = "users/u1/projects/p1/source.mp4";
      const file = await local("video.bin", "0123456789");
      expect(await storage().publish(key, file, "video/mp4")).toBe(10);
      expect(existsSync(file)).toBe(false); // moved or uploaded, not left behind
      expect(await storage().stat(key)).toEqual({ size: 10 });
      expect(await storage().stat("users/u1/projects/p1/missing.mp4")).toBeNull();
      expect(await storage().readText(key)).toBe("0123456789");
      const copy = path.join(dir, "scratch", "copy.bin");
      await storage().download(key, copy);
      expect(await readFile(copy, "utf8")).toBe("0123456789");
      // Something ffmpeg can open: a file or a link.
      const readable = await storage().readable(key);
      if (driver === "local") expect(await readFile(readable, "utf8")).toBe("0123456789");
      else expect(await (await fetch(readable)).text()).toBe("0123456789");
    });

    it("serves objects to browsers, with ranges, download names and a proxy for HLS", async () => {
      const key = "users/u1/projects/p1/exports/clip.mp4";
      await storage().publish(key, await local("clip.bin", "abcdefghij"), "video/mp4");
      const req = (range?: string) => new Request("http://app/x", { headers: range ? { range } : {} });

      const whole = await fetchServed(await storage().serve(req(), key, { type: "video/mp4" }));
      expect(whole.status).toBe(200);
      expect(await whole.text()).toBe("abcdefghij");
      const part = await fetchServed(await storage().serve(req("bytes=2-4"), key, { type: "video/mp4" }), "bytes=2-4");
      expect(part.status).toBe(206);
      expect(await part.text()).toBe("cde");

      const download = await storage().serve(req(), key, { type: "video/mp4", downloadName: "My-clip.mp4" });
      const disposition = download.status === 302 ? (await fetch(download.headers.get("location")!)).headers.get("content-disposition") : download.headers.get("content-disposition");
      expect(disposition).toContain("My-clip.mp4");

      // Proxied: the bytes come through this server, ranges too.
      const proxied = await storage().serve(req("bytes=0-2"), key, { type: "video/mp4", proxy: true });
      expect(proxied.status).toBe(206);
      expect(await proxied.text()).toBe("abc");

      await expect(storage().serve(req(), "users/u1/projects/p1/nope.mp4", { type: "video/mp4" })).rejects.toMatchObject({ status: 404 });
      await expect(storage().serve(req(), "users/u1/projects/p1/nope.m4s", { type: "video/mp4", proxy: true })).rejects.toMatchObject({ status: 404 });
    });

    it("takes uploads in parts, retried and finished", async () => {
      const key = "users/u1/projects/p2/upload.bin";
      const id = await storage().startUpload(key);
      const first = Buffer.alloc(5 * 1024 * 1024, 7); // S3's smallest part (but the last)
      const last = Buffer.from("the end");
      const e1 = await storage().uploadPart(key, id, 1, 0, first);
      const again = await storage().uploadPart(key, id, 1, 0, first); // a retried part replaces itself
      const e2 = await storage().uploadPart(key, id, 2, first.length, last);
      expect(again).toBe(e1);
      await storage().finishUpload(key, id, [
        { n: 2, etag: e2 },
        { n: 1, etag: again },
      ]);
      expect(await storage().stat(key)).toEqual({ size: first.length + last.length });

      const dropped = "users/u1/projects/p2/dropped.bin";
      const id2 = await storage().startUpload(dropped);
      await storage().uploadPart(dropped, id2, 1, 0, Buffer.from("x"));
      await storage().abortUpload(dropped, id2);
      expect(await storage().stat(dropped)).toBeNull();
    });

    it("writes text in place, and removes one object or a whole project", async () => {
      await putText("users/u1/projects/p3/live/source.m3u8", "#EXTM3U\n", "application/vnd.apple.mpegurl");
      expect(await storage().readText("users/u1/projects/p3/live/source.m3u8")).toBe("#EXTM3U\n");
      await storage().publish("users/u1/projects/p3/thumb.jpg", await local("t.jpg", "jpg"), "image/jpeg");
      await storage().publish("users/u1/projects/p3/frames/12.jpg", await local("f.jpg", "frame"), "image/jpeg");
      await storage().publish("users/u1/projects/p30/thumb.jpg", await local("o.jpg", "other"), "image/jpeg");

      await storage().remove("users/u1/projects/p3/thumb.jpg");
      expect(await storage().stat("users/u1/projects/p3/thumb.jpg")).toBeNull();
      await storage().removePrefix("users/u1/projects/p3");
      expect(await storage().stat("users/u1/projects/p3/frames/12.jpg")).toBeNull();
      expect(await storage().readText("users/u1/projects/p3/live/source.m3u8")).toBeNull();
      // Only that project: p30 shares the start of its name.
      expect(await storage().stat("users/u1/projects/p30/thumb.jpg")).toEqual({ size: 5 });
    });

    it("refuses keys that could leave their place", async () => {
      for (const bad of ["../etc/passwd", "users/../../x", "users//x", "/abs", "users/u1/a b"]) {
        await expect(storage().stat(bad)).rejects.toMatchObject({ status: 400 });
      }
    });
  });
}
