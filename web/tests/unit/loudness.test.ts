import { describe, expect, it } from "vitest";
import { loudnessMarks, loudnessMeter, mergeLoudness, SILENT_DB } from "@/lib/clips/loudness";

/** `seconds` of a sine wave at `amplitude` (0 to 1 of full scale), 16 kHz. */
const tone = (seconds: number, amplitude: number) =>
  Int16Array.from({ length: Math.round(seconds * 16_000) }, (_, i) => Math.round(Math.sin((2 * Math.PI * 440 * i) / 16_000) * amplitude * 32767));

describe("loudness", () => {
  it("measures each second in dBFS, in chunks of any size", () => {
    const meter = loudnessMeter(16_000);
    const audio = new Int16Array([...tone(2, 0.5), ...tone(1, 0.05), ...tone(0.5, 0.5)]);
    // Fed in odd-sized pieces, as a file stream would.
    for (let i = 0; i < audio.length; i += 7001) meter.push(audio.subarray(i, i + 7001));
    // A sine's RMS is amplitude / √2: half scale is about -9 dB, a twentieth about -29 dB. The
    // last half second counts (at least a quarter of a second).
    expect(meter.done()).toEqual([-9, -9, -29, -9]);
  });

  it("calls silence silent, and leaves out a sliver at the end", () => {
    const meter = loudnessMeter(16_000);
    meter.push(new Int16Array(16_000));
    meter.push(tone(0.1, 0.5));
    expect(meter.done()).toEqual([SILENT_DB]);
  });

  it("lays a followed stream's newest piece over what came before", () => {
    expect(mergeLoudness([-20, -20, -20, -20], [-5, -6], 2)).toEqual([-20, -20, -5, -6]);
    // A gap before the piece is silence; nothing new keeps what was there.
    expect(mergeLoudness([-20], [-5], 3)).toEqual([-20, SILENT_DB, SILENT_DB, -5]);
    expect(mergeLoudness([-20], undefined, 3)).toEqual([-20]);
    expect(mergeLoudness(undefined, [-5], 0)).toEqual([-5]);
  });

  it("marks the loudest lines only when something stands out", () => {
    const lines = Array.from({ length: 20 }, (_, i) => ({ start: i * 5, end: i * 5 + 5 }));
    const loudness = Array.from({ length: 100 }, (_, s) => (s >= 50 && s < 55 ? -6 : s >= 70 && s < 80 ? -14 : -26));
    const marks = loudnessMarks(lines, loudness);
    expect(marks[10]).toBe("!!");
    expect(marks.filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(marks.filter(Boolean).length).toBeLessThanOrEqual(5);
    expect(marks[0]).toBe("");
    expect(loudnessMarks(lines, Array(100).fill(-18)).every((m) => m === "")).toBe(true);
    expect(loudnessMarks(lines, undefined).every((m) => m === "")).toBe(true);
  });
});
