import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiError } from "@google/genai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clipTarget, clipTimes, findHighlights, highlightPrompt, hypeScore, MAX_CLIPS_PER_SEARCH, mockTranscribe, promptLines, tidySegments } from "@/lib/ai/server/clips-ai";
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
    expect(clipTarget(3 * 3600, "short")).toBe(MAX_CLIPS_PER_SEARCH);
    // About one clip per 2.5 minutes of 30 to 60 s clips: a 28-minute stream gets 11, an hour 24.
    expect(clipTarget(28 * 60, "medium")).toBe(11);
    expect(clipTarget(3600, "medium")).toBe(24);
    expect(clipTarget(88 * 60, "long")).toBe(25);
    // Short videos: at least 3 where they fit.
    expect(clipTarget(120, "short")).toBe(3);
    expect(clipTarget(70, "medium")).toBe(2);
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

describe("the clip-finding prompt", () => {
  // Phrases about 2.5 s long; a sentence ends every third one.
  const phrases = Array.from({ length: 30 }, (_, i) => ({ start: i * 3 + 0.4, end: i * 3 + 2.9, text: i % 3 === 2 ? `phrase ${i} ends.` : `phrase ${i}` }));

  it("merges phrases into lines of 5 to 12 seconds, numbered by their start second", () => {
    const lines = promptLines(phrases);
    expect(lines.length).toBeLessThan(phrases.length / 2);
    expect(lines[0]).toMatchObject({ n: 0, start: 0.4, text: "phrase 0 phrase 1 phrase 2 ends." });
    for (const l of lines) expect(l.end - l.start).toBeLessThanOrEqual(12);
    for (const [i, l] of lines.entries()) if (i > 0) expect(l.n).toBeGreaterThan(lines[i - 1]!.n);
    // Words of scripts without spaces join without one.
    expect(promptLines([{ start: 0, end: 1, text: "你 好" }, { start: 1, end: 2, text: "世 界" }])[0]!.text).toBe("你好世界");
  });

  it("maps line numbers back to exact phrase times, and trims a clip that runs long at a line end", () => {
    const lines = promptLines(phrases);
    // Lines 0, 9, 18...: start at 9, end before 36 (lines 9 to 27).
    expect(clipTimes({ start: 9, end: 36 }, lines, 90)).toEqual({ start: 9.4, end: 35.9 });
    // A number between lines counts the line it falls in.
    expect(clipTimes({ start: 10, end: 30 }, lines, 90)).toEqual({ start: 9.4, end: 35.9 });
    // The end of the video.
    expect(clipTimes({ start: 81, end: 90 }, lines, 90).end).toBe(89.9);
    // Too long for 15 to 30 s: lines come off the end.
    expect(clipTimes({ start: 0, end: 54 }, lines, 90, { minSec: 15, maxSec: 33 })).toEqual({ start: 0.4, end: 26.9 });
  });

  it("puts the transcript first and the request last", () => {
    const lines = promptLines(phrases);
    const a = highlightPrompt({ lines, title: "T", durationSec: 90, clipLength: "short", target: 2 });
    const b = highlightPrompt({ lines, title: "T", durationSec: 90, clipLength: "long", target: 3, avoid: [{ start: 0, end: 20 }] });
    const transcript = lines.map((l) => `${l.n} ${l.text}`).join("\n");
    // Asking again about the same video starts with the same text (Gemini caches it).
    expect(a.slice(0, a.indexOf(transcript) + transcript.length)).toBe(b.slice(0, b.indexOf(transcript) + transcript.length));
    expect(b).toContain("0:00-0:20");
    expect(a).not.toContain("[");
    // A number to fill, not "up to": the model otherwise stops after a handful.
    expect(a).toContain("Find 2 clips, each 15 to 30 seconds long, and return all 2, best first");
  });

  it("marks the loudest lines, where the hype often is", () => {
    // 90 s at a calm -30 dB, with a shout (-8 dB) at 56 to 62 s (inside the line from 54.4 s).
    const loudness = Array.from({ length: 90 }, (_, s) => (s >= 56 && s < 62 ? -8 : -30));
    const lines = promptLines(phrases, loudness);
    const shout = lines.find((l) => l.start <= 58 && l.end >= 58)!;
    expect(shout.mark).toBe("!!");
    expect(lines.filter((l) => l.mark === "!!")).toHaveLength(1);
    const prompt = highlightPrompt({ lines, title: "T", durationSec: 90, clipLength: "short", target: 3 });
    expect(prompt).toContain(`${shout.n} !! `);
    expect(prompt).toContain("Lines marked ! are louder than most of the video");
    // Even loudness throughout: nothing stands out, no marks.
    expect(promptLines(phrases, Array(90).fill(-20)).some((l) => l.mark)).toBe(false);
    expect(highlightPrompt({ lines: promptLines(phrases), title: "T", durationSec: 90, clipLength: "short", target: 3 })).not.toContain("Lines marked");
  });

  it("ranks by hype first, then the hook, then the payoff", () => {
    expect(hypeScore({ hype: 10, hook: 10, payoff: 10 })).toBe(100);
    expect(hypeScore({ hype: 1, hook: 1, payoff: 1 })).toBe(10);
    // A loud, gripping moment beats a calm, tidy one.
    expect(hypeScore({ hype: 9, hook: 7, payoff: 5 })).toBeGreaterThan(hypeScore({ hype: 4, hook: 7, payoff: 9 })!);
    expect(hypeScore({ hype: 14, hook: 0, payoff: 5 })).toBe(hypeScore({ hype: 10, hook: 1, payoff: 5 }));
    expect(hypeScore({ score: 70 })).toBe(70);
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
