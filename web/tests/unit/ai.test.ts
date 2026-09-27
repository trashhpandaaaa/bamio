import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  directorOutputSchema,
  hooksOutputSchema,
  normalizeAction,
  scriptOutputSchema,
} from "@/lib/ai/contracts";
import { AiError, toAiError } from "@/lib/ai/server/gemini";
import { mockDirector, mockHooks, mockImage, mockScript, mockVoice } from "@/lib/ai/server/mock";
import { aiRoute } from "@/lib/ai/server/route";
import { isWav, pcmToWav, toWav, wavDuration } from "@/lib/audio/wav";
import type { Brief } from "@/lib/project/schema";

const brief: Brief = { idea: "Crispy chili oil eggs in 5 minutes", durationSec: 15, tone: "funny", voiceover: true };

describe("lenient model output parsing", () => {
  it("trims, clips and replaces dashes in hooks", () => {
    const out = hooksOutputSchema.parse({
      hooks: [{ text: `  Wait — ${"very ".repeat(60)}long  `, angle: 5 }, { text: "", angle: "" }],
    });
    expect(out.hooks).toHaveLength(1);
    expect(out.hooks[0]!.text).not.toMatch(/—/);
    expect(out.hooks[0]!.text.length).toBeLessThanOrEqual(160);
    expect(out.hooks[0]!.angle).toBe("");
  });

  it("clamps durations and repairs bad shots in scripts", () => {
    const out = scriptOutputSchema.parse({
      scenes: [
        { durationSec: "45", voiceover: "x", caption: "y", visual: "z", shot: "Close-Up" },
        { durationSec: -1, voiceover: "x", caption: "y", visual: "z", shot: "drone" },
      ],
    });
    expect(out.title).toBe("Untitled video");
    expect(out.scenes[0]).toMatchObject({ durationSec: 20, shot: "close-up" });
    expect(out.scenes[1]).toMatchObject({ durationSec: 1, shot: "medium" });
  });

  it("rejects output with no scenes", () => {
    expect(() => scriptOutputSchema.parse({ title: "t", scenes: [] })).toThrow();
  });

  it("normalises director actions", () => {
    expect(normalizeAction({ kind: "none", value: "" })).toBeNull();
    expect(normalizeAction({ kind: "duration", value: "2.46" })).toEqual({ kind: "duration", value: 2.5 });
    expect(normalizeAction({ kind: "duration", value: "soon" })).toBeNull();
    expect(normalizeAction({ kind: "duration", value: 99 })).toEqual({ kind: "duration", value: 20 });
    expect(normalizeAction({ kind: "caption", value: "   " })).toBeNull();
    const out = directorOutputSchema.parse({
      summary: "s",
      notes: [{ severity: "urgent", title: "t", body: "b", scene: "2", action: { kind: "caption", value: "hi" } }],
    });
    expect(out.notes[0]).toMatchObject({ severity: "improve", scene: 2, action: { kind: "caption", value: "hi" } });
  });
});

describe("mock provider", () => {
  it("produces outputs that pass the same validation as Gemini output", () => {
    expect(hooksOutputSchema.parse(mockHooks(brief)).hooks).toHaveLength(3);
    const script = mockScript({ brief, hook: "Eggs, but crispy" });
    expect(scriptOutputSchema.parse(script).scenes.length).toBeGreaterThan(0);
    const director = mockDirector({
      brief,
      hook: "h",
      scenes: script.scenes.map((s) => ({ ...s, hasImage: false })),
    });
    expect(directorOutputSchema.parse(director).notes.length).toBeGreaterThan(0);
  });

  it("returns a real PNG and a real WAV", () => {
    const png = Buffer.from(mockImage({ visual: "eggs", shot: "close-up", tone: "funny" }).data, "base64");
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.readUInt32BE(16)).toBe(216);
    expect(png.readUInt32BE(20)).toBe(384);
    const wav = new Uint8Array(Buffer.from(mockVoice({ text: "one two three four five six", voice: "Puck", tone: "bold" }).data, "base64"));
    expect(isWav(wav)).toBe(true);
    expect(wavDuration(wav)).toBeCloseTo(6 / 2.6, 1);
  });
});

describe("wav helpers", () => {
  it("wraps PCM using the rate from the mime type", () => {
    const pcm = new Uint8Array(48_000 * 2); // 1 s at 48 kHz mono 16-bit
    const { wav, durationSec } = toWav(pcm, "audio/L16;codec=pcm;rate=48000");
    expect(isWav(wav)).toBe(true);
    expect(durationSec).toBeCloseTo(1, 5);
  });

  it("defaults to 24 kHz and leaves WAV input untouched", () => {
    const wav = pcmToWav(new Uint8Array(24_000 * 2));
    expect(wavDuration(wav)).toBeCloseTo(1, 5);
    expect(toWav(wav, "audio/wav").wav).toBe(wav);
    expect(wavDuration(new Uint8Array([1, 2, 3]))).toBe(0);
  });

  it("drops a trailing odd byte instead of producing a broken file", () => {
    const wav = pcmToWav(new Uint8Array(101));
    expect(wav.length).toBe(44 + 100);
  });
});

describe("error mapping", () => {
  it("maps Gemini API errors to user-facing codes", () => {
    expect(toAiError(new ApiError({ message: "quota", status: 429 })).code).toBe("rate_limited");
    expect(toAiError(new ApiError({ message: "API key not valid", status: 400 })).code).toBe("no_key");
    expect(toAiError(new ApiError({ message: "denied", status: 403 })).code).toBe("not_available");
    expect(toAiError(new ApiError({ message: "boom", status: 500 })).code).toBe("upstream");
    const timeout = new Error("t");
    timeout.name = "TimeoutError";
    expect(toAiError(timeout).status).toBe(504);
    const known = new AiError("blocked", "no", 422);
    expect(toAiError(known)).toBe(known);
  });
});

describe("aiRoute", () => {
  const handler = aiRoute(z.object({ n: z.number() }), async ({ n }) => ({ doubled: n * 2 }));
  const req = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost:3000/api/x", { method: "POST", body, headers: { host: "localhost:3000", ...headers } });

  it("validates and answers", async () => {
    const ok = await handler(req(JSON.stringify({ n: 2 })));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ doubled: 4 });
  });

  it("rejects bad JSON, invalid input and cross-site origins", async () => {
    expect((await handler(req("{nope"))).status).toBe(400);
    const invalid = await handler(req(JSON.stringify({ n: "2" })));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("bad_request");
    const cross = await handler(req(JSON.stringify({ n: 2 }), { origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
    const same = await handler(req(JSON.stringify({ n: 2 }), { origin: "http://localhost:3000" }));
    expect(same.status).toBe(200);
  });

  it("turns thrown errors into JSON errors", async () => {
    const failing = aiRoute(z.object({}), async () => {
      throw new AiError("rate_limited", "slow down", 429);
    });
    const res = await failing(req("{}"));
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: "rate_limited", message: "slow down" } });
  });
});
