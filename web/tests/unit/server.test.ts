import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiError } from "@google/genai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clipTarget, findHighlights, mockTranscribe, tidySegments } from "@/lib/ai/server/clips-ai";
import { shouldFallBack, toAiError } from "@/lib/ai/server/gemini";
import { projectSchema } from "@/lib/clips/schema";
import { db } from "@/lib/server/db";
import { enqueue } from "@/lib/server/queue";
import { storage } from "@/lib/server/storage";
import { attachmentName, HttpError, isCrossSite, readJson, takeRateLimit } from "@/lib/server/http";
import {
  blankProject,
  countProjects,
  createProject,
  deleteProject,
  getProject,
  listProjects,
  mutateProject,
  mediaKeys,
  projectDir,
  readProject,
  readTranscript,
  writeTranscript,
} from "@/lib/server/store";
import { readClipDefaults } from "@/lib/profile/defaults";
import { z } from "zod";

describe("http helpers", () => {
  it("limits per key and window", () => {
    const key = `test-${Math.random()}`;
    takeRateLimit(key, 2, 1000, 0);
    takeRateLimit(key, 2, 1000, 10);
    expect(() => takeRateLimit(key, 2, 1000, 20)).toThrow(HttpError);
    expect(() => takeRateLimit(key, 2, 1000, 1001)).not.toThrow();
  });

  it("spots cross-site requests", () => {
    const req = (headers: Record<string, string>) => new Request("http://localhost:3000/api/x", { method: "POST", headers });
    expect(isCrossSite(req({ host: "localhost:3000", origin: "http://localhost:3000" }))).toBe(false);
    expect(isCrossSite(req({ host: "localhost:3000" }))).toBe(false);
    expect(isCrossSite(req({ host: "localhost:3000", origin: "https://evil.example" }))).toBe(true);
    expect(isCrossSite(req({ host: "localhost:3000", "sec-fetch-site": "cross-site" }))).toBe(true);
  });

  it("validates JSON bodies", async () => {
    const schema = z.object({ n: z.number() });
    const post = (body: string) => new Request("http://x/", { method: "POST", body });
    await expect(readJson(post('{"n":1}'), schema)).resolves.toEqual({ n: 1 });
    await expect(readJson(post("nope"), schema)).rejects.toMatchObject({ status: 400 });
    await expect(readJson(post('{"n":"1"}'), schema)).rejects.toMatchObject({ status: 400, message: expect.stringContaining("n:") });
    await expect(readJson(post(`{"n":1,"pad":"${"x".repeat(70_000)}"}`), schema)).rejects.toMatchObject({ status: 413 });
  });

  it("makes safe download names", () => {
    expect(attachmentName('My "best" clip / part 2', "mp4")).toBe("My-best-clip-part-2.mp4");
    expect(attachmentName("日本語", "mp4")).toBe("clip.mp4");
  });
});

describe("AI helpers", () => {
  it("falls back only when another model could help", () => {
    expect(shouldFallBack(new ApiError({ message: "busy", status: 503 }))).toBe(true);
    expect(shouldFallBack(new ApiError({ message: "limit", status: 429 }))).toBe(true);
    expect(shouldFallBack(new ApiError({ message: "gone", status: 404 }))).toBe(true);
    expect(shouldFallBack(new ApiError({ message: "bad", status: 400 }))).toBe(false);
    expect(shouldFallBack(new HttpError(503, "no_key", "x"))).toBe(false);
    expect(shouldFallBack(new TypeError("fetch failed"))).toBe(true);
  });

  it("maps SDK errors to user messages", () => {
    expect(toAiError(new ApiError({ message: "x", status: 429 }))).toMatchObject({ status: 429, code: "rate_limited" });
    expect(toAiError(new ApiError({ message: "API key not valid", status: 400 }))).toMatchObject({ status: 401, code: "no_key" });
    expect(toAiError(new Error("?"))).toMatchObject({ status: 502 });
  });

  it("tidies model timestamps", () => {
    const out = tidySegments(
      [
        { start: 5, end: 7, text: " later " },
        { start: 0, end: 3, text: "first   phrase" },
        { start: 2, end: 4, text: "overlaps" },
        { start: 8, end: 8, text: "zero length" },
        { start: 9, end: 11, text: "" },
        { start: 58, end: 70, text: "past the end" },
      ],
      60,
    );
    expect(out.map((s) => s.text)).toEqual(["first phrase", "overlaps", "later", "zero length", "past the end"]);
    expect(out[0]).toMatchObject({ start: 0, end: 2 });
    expect(out[3]!.end).toBeGreaterThan(8);
    expect(out.at(-1)!.end).toBe(60);
    for (let i = 1; i < out.length; i++) expect(out[i]!.start).toBeGreaterThanOrEqual(out[i - 1]!.end);
  });

  it("asks for a sensible number of clips", () => {
    expect(clipTarget(20, "medium")).toBe(1);
    expect(clipTarget(600, "short")).toBeGreaterThanOrEqual(5);
    expect(clipTarget(3 * 3600, "short")).toBe(15);
  });

  it("finds mock clips inside the video without overlapping existing ones", async () => {
    process.env.BAMIO_AI_MOCK = "1";
    const { segments } = mockTranscribe(300);
    const clips = await findHighlights({ segments, durationSec: 300, clipLength: "short", title: "t", avoid: [{ start: 0, end: 30 }] });
    expect(clips.length).toBeGreaterThan(0);
    for (const c of clips) {
      expect(c.start).toBeGreaterThanOrEqual(0);
      expect(c.end).toBeLessThanOrEqual(300);
      expect(Math.min(30, c.end) - Math.max(0, c.start)).toBeLessThanOrEqual(0);
    }
    delete process.env.BAMIO_AI_MOCK;
  });
});

describe("project store", () => {
  let dir: string;
  const user = "user_test123";

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "bamio-store-"));
    process.env.BAMIO_DATA_DIR = dir;
  });
  afterAll(async () => {
    delete process.env.BAMIO_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  const make = () =>
    blankProject({
      title: "Test",
      source: { kind: "upload", platform: "upload", title: "Test", durationSec: 0 },
      findClips: true,
      clipLength: "short",
      edit: { aspect: "1:1", titleText: "ignored" },
      job: { status: "queued", message: "Waiting" },
    });

  it("keeps paths inside the data folder", () => {
    expect(() => projectDir(user, "../../etc")).toThrow(HttpError);
    expect(() => projectDir("../evil", "0f8fad5b-d9cb-469f-a165-70867728950e")).toThrow(HttpError);
    expect(projectDir(user, "0F8FAD5B-D9CB-469F-A165-70867728950E").startsWith(dir)).toBe(true);
  });

  it("creates valid projects with the chosen look", () => {
    const p = make();
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(p.defaultEdit).toMatchObject({ aspect: "1:1", titleText: "", captionStyle: "pop" });
  });

  it("saves, lists and serialises changes", async () => {
    const p = make();
    await createProject(user, p);
    expect((await listProjects(user)).map((x) => x.id)).toContain(p.id);
    // Twenty concurrent renames must all land in order, none lost (each locks the row).
    await Promise.all(Array.from({ length: 20 }, (_, i) => mutateProject(user, p.id, (cur) => ({ ...cur, title: `${cur.title}.${i}` }))));
    const saved = await getProject(user, p.id);
    expect(saved.title.split(".")).toHaveLength(21);
    const [row] = await db()<{ title: string; updated_at: string }[]>`select data->>'title' as title, updated_at from projects where id = ${p.id}`;
    expect(row).toMatchObject({ title: saved.title });
    expect(Number(row!.updated_at)).toBe(saved.updatedAt);
    // Another user can't see, change or delete it.
    expect(await readProject("user_other", p.id)).toBeNull();
    await expect(mutateProject("user_other", p.id, (cur) => cur)).rejects.toMatchObject({ status: 404 });
    await deleteProject("user_other", p.id);
    expect(await readProject(user, p.id)).not.toBeNull();
  });

  it("keeps transcripts with their project, and deletes both with its media", async () => {
    const p = make();
    await createProject(user, p);
    const thumb = path.join(dir, "thumb-src.jpg");
    await writeFile(thumb, "jpg");
    await storage().publish(mediaKeys(user, p.id).thumb, thumb, "image/jpeg");
    const transcript = { language: "en", segments: [{ start: 0, end: 1.5, text: "hello there", words: [{ start: 0, end: 0.6 }, { start: 0.7, end: 1.5 }] }] };
    await writeTranscript(user, p.id, transcript);
    expect(await readTranscript(user, p.id)).toEqual(transcript);
    expect(await readTranscript("user_other", p.id)).toBeNull();
    await expect(writeTranscript("user_other", p.id, transcript)).rejects.toMatchObject({ status: 404 });
    await deleteProject(user, p.id);
    expect(await readProject(user, p.id)).toBeNull();
    const [left] = await db()`select 1 from transcripts where project_id = ${p.id}`;
    expect(left).toBeUndefined();
    expect(await storage().stat(mediaKeys(user, p.id).thumb)).toBeNull();
  });

  it("refuses a project past the user's limit", async () => {
    const owner = "user_limit";
    await createProject(owner, make(), 2);
    await createProject(owner, make(), 2);
    await expect(createProject(owner, make(), 2)).rejects.toMatchObject({ status: 409, code: "too_many" });
    expect(await countProjects(owner)).toBe(2);
  });

  it("reports work with no job behind it as cut off, but not work that is queued", async () => {
    const p = make();
    await createProject(user, p);
    const write = (project: object) => db()`update projects set data = ${db().json(JSON.parse(JSON.stringify(project)))} where id = ${p.id}`;
    // Just queued: its job is about to be (a moment's grace).
    expect((await getProject(user, p.id)).job).toMatchObject({ status: "queued" });
    // Queued two minutes ago and no job: cut off.
    const old = Date.now() - 120_000;
    await write({ ...p, job: { ...p.job, updatedAt: old } });
    expect((await getProject(user, p.id)).job).toMatchObject({ status: "failed" });
    // With a job queued, it's waiting, not stalled.
    await enqueue({ kind: "import", userId: user, projectId: p.id });
    expect((await getProject(user, p.id)).job).toMatchObject({ status: "queued" });
    await db()`delete from jobs where project_id = ${p.id}`;

    // Once the video is prepared, a cut-off analysis leaves the project usable.
    await write({ ...p, job: { ...p.job, status: "transcribing", updatedAt: old }, source: { ...p.source, width: 1280, height: 720, durationSec: 60 } });
    expect((await getProject(user, p.id)).job).toMatchObject({ status: "ready", warning: expect.stringContaining("Find clips") });
  });

  it("refuses a change by throwing, and keeps the file as it was", async () => {
    const p = make();
    await createProject(user, p);
    await expect(
      mutateProject(user, p.id, () => {
        throw new HttpError(409, "nope", "No");
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect((await getProject(user, p.id)).title).toBe("Test");
  });
});

describe("clip defaults", () => {
  it("reads saved values field by field", () => {
    expect(readClipDefaults(undefined)).toMatchObject({ aspect: "9:16", findClips: true });
    expect(readClipDefaults({ bamioClipDefaults: { aspect: "1:1", clipLength: "huge", captions: false } })).toEqual({
      language: "auto",
      findClips: true,
      clipLength: "medium",
      aspect: "1:1",
      captions: false,
      captionStyle: "pop",
    });
  });

  it("keeps a chosen language, and reads the old 'another language' as detect automatically", () => {
    expect(readClipDefaults({ bamioClipDefaults: { language: "hi" } }).language).toBe("hi");
    expect(readClipDefaults({ bamioClipDefaults: { language: "other" } }).language).toBe("auto");
    expect(readClipDefaults({ bamioClipDefaults: { language: "not a language" } }).language).toBe("auto");
  });
});
