import { describe, expect, it } from "vitest";
import { commitPiece, followLimits, formatSpan, liveCaptureProblem, vodRange } from "@/lib/clips/live";
import { inputChoices, parsePlaylistWindow, segmentAt } from "@/lib/server/hls";
import { chooseRecording, followStart, playlistStart, usableRewind } from "@/lib/server/live";

describe("live capture rules", () => {
  const twitch = { canRewind: true, rewindSec: 8729 };
  const youtube = { canRewind: false, rewindSec: 30 };

  it("accepts sensible captures", () => {
    expect(liveCaptureProblem(300, 0, twitch)).toBeNull(); // the last 5 minutes
    expect(liveCaptureProblem(300, 600, twitch)).toBeNull(); // 5 minutes back, then 10 more
    expect(liveCaptureProblem(0, 300, youtube)).toBeNull(); // record 5 minutes from now
  });

  it("explains captures that can't be made", () => {
    expect(liveCaptureProblem(60, 300, youtube)).toMatch(/only be recorded from now/);
    expect(liveCaptureProblem(9000, 0, twitch)).toMatch(/only go back 2 h 25 min/);
    expect(liveCaptureProblem(0, 5, youtube)).toMatch(/at least 10 seconds/);
    expect(liveCaptureProblem(0, 0, twitch)).toMatch(/at least 10 seconds/);
    expect(liveCaptureProblem(0, 7200, youtube)).toMatch(/up to 1 h from now/);
    expect(liveCaptureProblem(3 * 3600, 3600, { canRewind: true, rewindSec: 5 * 3600 })).toMatch(/up to 3 h at a time/);
    expect(liveCaptureProblem(Number.NaN, 0, twitch)).toMatch(/Choose how much/);
  });

  it("formats spans", () => {
    expect(formatSpan(45)).toBe("45 s");
    expect(formatSpan(300)).toBe("5 min");
    expect(formatSpan(3600)).toBe("1 h");
    expect(formatSpan(8729)).toBe("2 h 25 min");
  });
});

describe("vodRange", () => {
  const live = { rewindSec: 300, recordSec: 600, requestedAt: 1_000_000, vodDurationSec: 5000 };

  it("covers from the rewind point to when recording stopped", () => {
    expect(vodRange(live, 1_000_000 + 600_000)).toEqual({ start: 4700, end: 5600 }); // full recording
    expect(vodRange(live, 1_000_000 + 120_000)).toEqual({ start: 4700, end: 5120 }); // stopped after 2 min
    expect(vodRange(live, 1_000_000 + 9_000_000)).toEqual({ start: 4700, end: 5600 }); // never past recordSec
  });

  it("never starts before the stream and always spans a moment", () => {
    expect(vodRange({ ...live, rewindSec: 9000 }, 1_000_000)).toEqual({ start: 0, end: 5000 });
    expect(vodRange({ ...live, rewindSec: 0, recordSec: 0 }, 1_000_000)).toEqual({ start: 5000, end: 5001 });
  });
});

describe("live playlists", () => {
  it("measures a playlist's history", () => {
    const text = ["#EXTM3U", "#EXT-X-TARGETDURATION:5", ...Array.from({ length: 720 }, () => "#EXTINF:5.000,\nseg.ts")].join("\n");
    expect(parsePlaylistWindow(text)).toEqual({ windowSec: 3600, segmentSec: 5 });
    expect(parsePlaylistWindow("#EXTM3U\n#EXTINF:2.002,\na.ts\n#EXTINF:2.002,\nb.ts").segmentSec).toBeCloseTo(2.002);
  });

  it("finds the segment that holds a moment", () => {
    const text = ["#EXTM3U", "#EXT-X-TARGETDURATION:10", ...Array.from({ length: 5 }, (_, i) => `#EXTINF:10.000,\n${i}.ts`)].join("\n");
    expect(segmentAt(text, 0)).toEqual({ index: 0, start: 0 });
    expect(segmentAt(text, 25)).toEqual({ index: 2, start: 20 });
    expect(segmentAt(text, 999)).toEqual({ index: 4, start: 40 }); // past the end: the last one
  });

  it("starts the right number of segments back", () => {
    expect(playlistStart(60, 3600, 5)).toEqual({ startIndex: -13, backlog: 65 }); // one spare segment
    expect(playlistStart(0, 3600, 5)).toEqual({ startIndex: -3, backlog: 15 }); // DVR stream, from now
    expect(playlistStart(0, 28, 2)).toEqual({ startIndex: 0, backlog: 28 }); // short playlist: keep it all
    expect(playlistStart(600, 300, 5)).toEqual({ startIndex: 0, backlog: 300 }); // can't go further than the playlist
  });

  it("lists one combined stream, then video plus audio", () => {
    const v = { url: "v", protocol: "m3u8_native", vcodec: "avc1", acodec: "none", height: 1080 };
    const a = { url: "a", protocol: "m3u8_native", vcodec: "none", tbr: 128 };
    const av = { url: "av", protocol: "m3u8_native", vcodec: "avc1", acodec: "mp4a", height: 720 };
    const urls = (choices: { url?: string }[][]) => choices.map((c) => c.map((f) => f.url));
    expect(urls(inputChoices([v, a, av]))).toEqual([["av"], ["v", "a"]]);
    expect(urls(inputChoices([v, a]))).toEqual([["v", "a"]]);
    expect(inputChoices([{ ...v, height: 2160 }, a])).toEqual([[{ ...v, height: 2160 }]]); // over 1080p only as a last resort
    expect(inputChoices([{ ...v, protocol: "https" }])).toEqual([]);
  });

  it("records from the playlist that reaches back far enough", () => {
    // YouTube: the combined playlist keeps 30 s, the separate ones the 15 min rewind window.
    const combined = { name: "combined", windowSec: 30, segmentSec: 2 };
    const separate = { name: "separate", windowSec: 900, segmentSec: 2 };
    expect(usableRewind(separate)).toBe(894);
    expect(chooseRecording([combined, separate], 0)?.name).toBe("combined"); // from now: the simplest
    expect(chooseRecording([combined, separate], 60)?.name).toBe("separate");
    expect(chooseRecording([combined, separate], 3000)?.name).toBe("separate"); // as far as any can go
    expect(chooseRecording([separate], 60)?.name).toBe("separate");
    expect(chooseRecording([], 60)).toBeUndefined();
  });
});

describe("following a stream", () => {
  it("records no more of it than the AI minutes left (the free trial: 8 minutes of stream, not 12 hours)", () => {
    // The free trial, untouched: 8 minutes back at most, and it stops after 9 minutes recorded.
    expect(followLimits(8 * 60, 6 * 3600)).toEqual({ backSec: 8 * 60, stopAtSec: 9 * 60 });
    // A stream that keeps little history starts where it can.
    expect(followLimits(8 * 60, 20)).toEqual({ backSec: 20, stopAtSec: 9 * 60 });
    // Minutes nearly gone: barely any; none left: only the minute of grace.
    expect(followLimits(90, 3600)).toEqual({ backSec: 90, stopAtSec: 150 });
    expect(followLimits(0, 3600)).toEqual({ backSec: 0, stopAtSec: 60 });
    // Pro's 400 minutes: 6 h 41 min of stream. Team's 1,000, or plans off: the usual 12 hours.
    expect(followLimits(400 * 60, 3600)).toEqual({ backSec: 3600, stopAtSec: 401 * 60 });
    expect(followLimits(1000 * 60, 3600)).toEqual({ backSec: 3600, stopAtSec: 12 * 3600 });
    expect(followLimits(Infinity, 6 * 3600)).toEqual({ backSec: 6 * 3600, stopAtSec: 12 * 3600 });
  });

  const hour = 3600;

  it("starts at the stream's start when it can, else as far back as allowed", () => {
    // Twitch: the in-progress VOD is the whole stream.
    expect(followStart({ availableSec: 2 * hour, vod: { url: "v", durationSec: 2 * hour } }, undefined)).toEqual({ backSec: 2 * hour, fromStart: true });
    expect(followStart({ availableSec: 27 * hour, vod: { url: "v", durationSec: 27 * hour } }, undefined)).toEqual({ backSec: 6 * hour, fromStart: false });
    // YouTube: its rewind history; the start is reached when the stream is younger than it.
    const now = 1_000_000_000_000;
    expect(followStart({ availableSec: 3600 }, now - 1800_000, now)).toEqual({ backSec: 3600, fromStart: true });
    expect(followStart({ availableSec: 900 }, now - 5 * hour * 1000, now)).toEqual({ backSec: 900, fromStart: false });
    // Kick: a few seconds, and the start unknown.
    expect(followStart({ availableSec: 30 }, undefined)).toEqual({ backSec: 30, fromStart: false });
  });

  const p = (start: number, end: number) => ({ start, end });

  it("keeps the phrases of a piece up to a pause clear of its end", () => {
    // Piece 100..160 s: the phrase ending near the edge may be cut, so keep up to the pause before it.
    expect(commitPiece([p(100, 110), p(111, 120), p(140, 158)], 100, 160, false)).toEqual({ keep: [p(100, 110), p(111, 120)], until: 130 });
    // Silence after the last phrase: all of it is done.
    expect(commitPiece([p(100, 110)], 100, 160, false)).toEqual({ keep: [p(100, 110)], until: 157 });
    // No speech at all.
    expect(commitPiece([], 100, 160, false)).toEqual({ keep: [], until: 157 });
    // The last piece keeps everything.
    expect(commitPiece([p(100, 110), p(150, 160)], 100, 160, true)).toEqual({ keep: [p(100, 110), p(150, 160)], until: 160 });
  });

  it("always moves forward, even through speech without pauses", () => {
    const run = [p(0, 5), p(5.1, 10), p(10.1, 15)];
    const { keep, until } = commitPiece(run, 0, 16, false);
    expect(keep).toEqual([p(0, 5), p(5.1, 10)]);
    expect(until).toBe(10);
    expect(commitPiece([p(0, 15.5)], 0, 16, false).until).toBeGreaterThan(0);
  });
});
