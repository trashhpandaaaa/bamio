import { describe, expect, it } from "vitest";
import { assTime, buildAss, CAPTION_FONT, escapeAssText } from "@/lib/clips/ass";
import { captionLines } from "@/lib/clips/logic";
import { parseFfmpegProgress, parseYtdlpProgress } from "@/lib/clips/progress";
import { renderArgs, renderFilter } from "@/lib/clips/render";
import { detectPlatform, isPrivateAddress, parseVideoUrl } from "@/lib/clips/url";
import { parseRange } from "@/lib/server/files";
import { explainYtdlpError } from "@/lib/server/media";

describe("links", () => {
  it("accepts public http(s) links", () => {
    expect(parseVideoUrl(" https://www.youtube.com/watch?v=jNQXAC9IVRw ").ok).toBe(true);
    expect(parseVideoUrl("http://kick.com/somebody/videos/123").ok).toBe(true);
  });

  it("rejects other schemes, credentials and private hosts", () => {
    for (const bad of [
      "not a url",
      "ftp://example.com/v.mp4",
      "file:///C:/video.mp4",
      "https://user:pass@example.com/v",
      "http://localhost:3000/x",
      "http://intranet/x",
      "http://printer.local/x",
      "http://127.0.0.1/x",
      "http://10.1.2.3/x",
      "http://192.168.0.10/x",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/x",
      "http://[fd00::1]/x",
      "http://[::ffff:10.0.0.1]/x",
    ]) {
      expect(parseVideoUrl(bad).ok, bad).toBe(false);
    }
  });

  it("classifies private addresses", () => {
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("172.20.1.1")).toBe(true);
    expect(isPrivateAddress("224.0.0.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("2606:4700::1111")).toBe(false);
    expect(isPrivateAddress("youtube.com")).toBe(false);
  });

  it("detects platforms", () => {
    expect(detectPlatform(new URL("https://youtu.be/abc"))).toBe("youtube");
    expect(detectPlatform(new URL("https://m.youtube.com/watch?v=1"))).toBe("youtube");
    expect(detectPlatform(new URL("https://www.twitch.tv/videos/1"))).toBe("twitch");
    expect(detectPlatform(new URL("https://clips.twitch.tv/x"))).toBe("twitch");
    expect(detectPlatform(new URL("https://kick.com/x"))).toBe("kick");
    expect(detectPlatform(new URL("https://vimeo.com/1"))).toBe("other");
  });

  it("turns yt-dlp errors into plain advice", () => {
    expect(explainYtdlpError("ERROR: Unsupported URL: https://x")).toMatch(/can’t read videos from that page/);
    expect(explainYtdlpError("Sign in to confirm you’re not a bot")).toMatch(/isn’t a bot/);
    expect(explainYtdlpError("ERROR: [youtube] x: Private video")).toMatch(/private/);
    expect(explainYtdlpError("ERROR: Video unavailable")).toMatch(/isn’t available/);
    expect(explainYtdlpError("something odd")).toMatch(/couldn’t read that link/);
  });
});

describe("progress parsing", () => {
  it("reads yt-dlp's template line", () => {
    expect(parseYtdlpProgress("BAMIO  42.5%")).toBeCloseTo(0.425);
    expect(parseYtdlpProgress("BAMIO 100.0%")).toBe(1);
    expect(parseYtdlpProgress("[download] Destination: x.mp4")).toBeNull();
  });

  it("reads ffmpeg -progress output", () => {
    expect(parseFfmpegProgress("out_time_us=12500000")).toBe(12.5);
    expect(parseFfmpegProgress("out_time_ms=1000000")).toBe(1);
    expect(parseFfmpegProgress("frame=10")).toBeNull();
  });
});

describe("byte ranges", () => {
  it("parses the forms browsers send", () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(parseRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("rejects ranges it can't satisfy and ignores ones it doesn't support", () => {
    for (const bad of ["bytes=100-", "bytes=20-10", "bytes=-0"]) expect(parseRange(bad, 100), bad).toBe("invalid");
    for (const ignored of ["bytes=-", "items=0-1", "bytes=0-1,5-6"]) expect(parseRange(ignored, 100), ignored).toBeNull();
  });
});

describe("ASS subtitles", () => {
  it("formats times and escapes override characters", () => {
    expect(assTime(3723.456)).toBe("1:02:03.46");
    expect(escapeAssText("a{\\b1}b\nc")).toBe("a(/b1)b c");
  });

  const lines = captionLines([{ start: 0, end: 3, text: "wait for it" }], 0, 3, "pop");

  it("reveals pop captions word by word", () => {
    const ass = buildAss({ lines, aspect: "9:16", style: "pop", position: "bottom", durationSec: 3 });
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain(`Style: Caption,${CAPTION_FONT},110,`);
    const events = ass.split("\n").filter((l) => l.startsWith("Dialogue:"));
    expect(events).toHaveLength(3);
    // First event: first word highlighted, the rest drawn but invisible.
    expect(events[0]).toContain("{\\c&H0055EACD&\\fscx110\\fscy110}wait{\\r} {\\alpha&HFF&}for{\\r} {\\alpha&HFF&}it{\\r}");
    expect(events[2]).toMatch(/,Caption,,0,0,0,,wait for \{\\c/);
  });

  it("writes one event per line for other styles, plus a title", () => {
    const ass = buildAss({ lines, aspect: "16:9", style: "boxed", position: "middle", durationSec: 3, title: "Big {news}" });
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toMatch(/Style: Caption,[^\n]*,3,14,0,5,/); // opaque box, middle alignment
    expect(ass).toContain("Dialogue: 1,0:00:00.00,0:00:03.00,Title,,0,0,0,,Big (news)");
    expect(ass).toContain(",Caption,,0,0,0,,wait for it");
  });
});

describe("render arguments", () => {
  it("crops then scales for fill framing", () => {
    const f = renderFilter({ srcW: 1920, srcH: 1080, edit: { aspect: "9:16", framing: "crop", focusX: 0.5 }, subtitles: true });
    expect(f).toBe("[0:v]crop=606:1080:656:0,scale=1080:1920:flags=lanczos,setsar=1[base];[base]ass=subs.ass:fontsdir=fonts:shaping=complex,format=yuv420p[v]");
  });

  it("fits over a blurred fill", () => {
    const f = renderFilter({ srcW: 1920, srcH: 1080, edit: { aspect: "9:16", framing: "fit", focusX: 0.5 }, subtitles: false });
    expect(f).toContain("split=2[bgsrc][fgsrc]");
    expect(f).toContain("boxblur");
    expect(f).toContain("overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2");
    expect(f).toMatch(/\[base\]format=yuv420p\[v\]$/);
  });

  it("seeks before the input and handles silent sources", () => {
    const base = { input: "in.mp4", output: "out.mp4", start: 12.3456, duration: 30, srcW: 1280, srcH: 720, edit: { aspect: "1:1" as const, framing: "crop" as const, focusX: 0.5 }, subtitles: false };
    const args = renderArgs({ ...base, hasAudio: true });
    expect(args.slice(args.indexOf("-ss"), args.indexOf("-ss") + 4)).toEqual(["-ss", "12.346", "-i", "in.mp4"]);
    expect(args).toContain("0:a:0?");
    expect(args.at(-1)).toBe("out.mp4");
    const silent = renderArgs({ ...base, hasAudio: false });
    expect(silent).toContain("-an");
    expect(silent).not.toContain("aac");
  });
});
