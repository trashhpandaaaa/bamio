import "server-only";
import { deflateSync } from "node:zlib";
import type {
  DirectorOutput,
  DirectorRequest,
  HooksOutput,
  ImageRequest,
  ScriptOutput,
  ScriptRequest,
  VoiceRequest,
} from "@/lib/ai/contracts";
import type { Brief } from "@/lib/project/schema";
import { pcmToWav } from "@/lib/audio/wav";

/* Deterministic stand-ins for Gemini, used when BAMIO_AI_MOCK=1 (tests and demos without a key). */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const short = (s: string, words = 6) => s.split(/\s+/).slice(0, words).join(" ").replace(/[.,;:]$/, "");

export function mockHooks(brief: Brief): HooksOutput {
  const topic = short(brief.idea).toLowerCase();
  return {
    hooks: [
      { text: `Nobody tells you this about ${topic}`, angle: "Curiosity gap: promises inside knowledge in the first second." },
      { text: `I tried ${topic} for a week. Here is what happened`, angle: "Result first: viewers stay to see the payoff." },
      { text: `Stop scrolling if you care about ${topic}`, angle: "Direct call-out to the exact viewer who should watch." },
    ],
  };
}

export function mockScript({ brief, hook }: ScriptRequest): ScriptOutput {
  const each = Math.round((brief.durationSec / 4) * 10) / 10;
  const vo = (text: string) => (brief.voiceover ? text : "");
  return {
    title: short(brief.idea, 5),
    scenes: [
      { durationSec: each, voiceover: vo(hook), caption: short(hook, 7).toLowerCase(), visual: `A person reacting with surprise to ${short(brief.idea, 4)}`, shot: "close-up" },
      { durationSec: each, voiceover: vo("Here is the part most people get wrong."), caption: "most people get this wrong", visual: "Hands setting up the first step on a wooden table", shot: "overhead" },
      { durationSec: each, voiceover: vo("Do this instead, and watch the difference."), caption: "do this instead", visual: "The finished result in soft window light", shot: "medium" },
      { durationSec: each, voiceover: vo("Follow for part two."), caption: "follow for part 2", visual: "", shot: "text-card" },
    ],
  };
}

export function mockDirector({ scenes }: DirectorRequest): DirectorOutput {
  const first = scenes[0];
  const second = scenes[1];
  return {
    summary: "Strong idea with a clear payoff. Tighten the opening so the hook lands in the first second.",
    notes: [
      {
        severity: "fix",
        title: "Shorten the opening caption",
        body: "Scene 1's caption should read in one glance. Keep only the sharpest words of the hook.",
        scene: 1,
        action: first ? { kind: "caption", value: "you're doing this wrong" } : null,
      },
      {
        severity: "improve",
        title: "Cut scene 2 faster",
        body: "Scene 2 holds a beat too long for what it says. A shorter scene keeps the momentum from the hook.",
        scene: 2,
        action: second ? { kind: "duration", value: Math.max(1, Math.round((second.durationSec - 0.5) * 10) / 10) } : null,
      },
      {
        severity: "polish",
        title: "Add a reason to follow",
        body: "The ending asks for a follow. Tell viewers what part two will show so the ask feels earned.",
        scene: 0,
        action: null,
      },
    ],
  };
}

/* ------------------------------ PNG -------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A small vertical PNG with a two-tone diagonal, colored from the prompt. */
export function mockImage({ visual }: ImageRequest): { mimeType: string; data: string } {
  const w = 216;
  const h = 384;
  const hue = hash(visual) % 360;
  const toRgb = (l: number): [number, number, number] => {
    const c = (1 - Math.abs(2 * l - 1)) * 0.55;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
      hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  };
  const light = toRgb(0.62);
  const dark = toRgb(0.3);
  const raw = new Uint8Array(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = x + y * 0.6 < w * 0.9 ? light : dark;
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const png = new Uint8Array([
    ...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    ...chunk("IHDR", ihdr),
    ...chunk("IDAT", new Uint8Array(deflateSync(raw))),
    ...chunk("IEND", new Uint8Array(0)),
  ]);
  return { mimeType: "image/png", data: Buffer.from(png).toString("base64") };
}

/** A quiet tone as long as the line would take to say (about 2.6 words per second). */
export function mockVoice({ text }: VoiceRequest): { mimeType: string; data: string } {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const seconds = Math.min(8, Math.max(0.8, words / 2.6));
  const rate = 24_000;
  const samples = Math.round(seconds * rate);
  const pcm = new Uint8Array(samples * 2);
  const view = new DataView(pcm.buffer);
  for (let i = 0; i < samples; i++) {
    const t = i / rate;
    const envelope = Math.min(1, t * 20, (seconds - t) * 20);
    view.setInt16(i * 2, Math.round(Math.sin(2 * Math.PI * 330 * t) * 1200 * envelope), true);
  }
  return { mimeType: "audio/wav", data: Buffer.from(pcmToWav(pcm, { sampleRate: rate, channels: 1, bitsPerSample: 16 })).toString("base64") };
}
