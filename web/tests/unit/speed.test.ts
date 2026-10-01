import { describe, expect, it } from "vitest";
import { parseSidx } from "@/lib/server/dash";
import { speechCpu } from "@/lib/server/transcribe";

/** A sidx box (version 0): timescale 1000, first fragment at `ept` ms, then [size, duration ms] per fragment. */
function sidx(ept: number, refs: [number, number][], firstOffset = 0): Buffer {
  const box = Buffer.alloc(32 + refs.length * 12);
  box.writeUInt32BE(box.length, 0);
  box.write("sidx", 4, "latin1");
  box.writeUInt32BE(0, 8); // version 0, no flags
  box.writeUInt32BE(1, 12); // reference ID
  box.writeUInt32BE(1000, 16); // timescale
  box.writeUInt32BE(ept, 20);
  box.writeUInt32BE(firstOffset, 24);
  box.writeUInt16BE(refs.length, 30);
  refs.forEach(([size, duration], i) => {
    box.writeUInt32BE(size, 32 + i * 12);
    box.writeUInt32BE(duration, 36 + i * 12);
    box.writeUInt32BE(0x90000000, 40 + i * 12);
  });
  return box;
}

describe("a file's fragment index", () => {
  it("lists where each fragment is and when it plays", () => {
    const box = sidx(5000, [
      [100, 2000],
      [200, 2000],
      [300, 1000],
    ]);
    // The index starts at byte 1000; the media follows it.
    const media = 1000 + box.length;
    expect(parseSidx(box, 1000)).toEqual([
      { start: 5, duration: 2, offset: media, size: 100 },
      { start: 7, duration: 2, offset: media + 100, size: 200 },
      { start: 9, duration: 1, offset: media + 300, size: 300 },
    ]);
    expect(parseSidx(sidx(0, [[10, 1000]], 64), 0)![0]!.offset).toBe(sidx(0, [[10, 1000]]).length + 64);
  });

  it("refuses an index of indexes", () => {
    const box = sidx(0, [[100, 1000]]);
    box.writeUInt32BE(0x80000064, 32); // reference type 1: points at another sidx
    expect(parseSidx(box, 0)).toBeNull();
  });
});

describe("speech on the CPU", () => {
  it("decodes several parts at once, two threads each, on about two thirds of the machine", () => {
    expect(speechCpu(12)).toEqual({ threads: 2, parallel: 4 });
    expect(speechCpu(8)).toEqual({ threads: 2, parallel: 2 });
    expect(speechCpu(4)).toEqual({ threads: 2, parallel: 1 });
    expect(speechCpu(2)).toEqual({ threads: 1, parallel: 1 });
    expect(speechCpu(64).parallel).toBe(6);
  });
});
