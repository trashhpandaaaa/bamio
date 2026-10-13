import { AudioBufferSink, AudioBufferSource, BufferTarget, CanvasSink, CanvasSource, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, Mp4OutputFormat, Output, WebMOutputFormat } from "mediabunny";
import type { Asset } from "./assets";
import { EDITOR_LIMITS } from "./model";

/*
 * Reverse: a part of a video played backwards. A <video> can't play backwards, so the part is
 * re-encoded backwards here in the browser, picture and sound, into a new file the edit keeps
 * like any other (nothing is uploaded). The frames are decoded a few at a time from the end
 * (a decoder only goes forwards), so memory stays small: at most a minute of video.
 */

const FPS = 30;
/** Frames decoded at once: each batch is decoded forwards, then written last-first. */
const BATCH = 12;

export class ReverseError extends Error {}

/** `asset`'s seconds `from` to `to`, backwards, as a new file. `onProgress`: 0 to 1. */
export async function reverseVideo(asset: Asset, from: number, to: number, onProgress: (done: number) => void, signal: AbortSignal): Promise<File> {
  const track = asset.videoTrack;
  if (!track) throw new ReverseError("Only a video can be reversed.");
  const length = to - from;
  if (length <= 0.1) throw new ReverseError("That part is too short to reverse.");
  if (length > EDITOR_LIMITS.maxReverseSec + 0.01) throw new ReverseError(`Up to ${EDITOR_LIMITS.maxReverseSec} seconds can be reversed at once. Split the clip first.`);

  // At most 1920 on the longer side, in even pixels.
  const k = Math.min(1, 1920 / Math.max(track.displayWidth, track.displayHeight));
  const width = Math.max(2, Math.round((track.displayWidth * k) / 2) * 2);
  const height = Math.max(2, Math.round((track.displayHeight * k) / 2) * 2);
  const bitrate = Math.round(Math.max(2_000_000, width * height * 5));
  let format: Mp4OutputFormat | WebMOutputFormat = new Mp4OutputFormat({ fastStart: "in-memory" });
  let videoCodec = await getFirstEncodableVideoCodec(["avc"], { width, height, bitrate });
  let extension = "mp4";
  if (!videoCodec) {
    format = new WebMOutputFormat();
    extension = "webm";
    videoCodec = await getFirstEncodableVideoCodec(["vp9", "vp8"], { width, height, bitrate });
  }
  if (!videoCodec) throw new ReverseError("This browser can’t encode video.");
  const audioCodec = asset.audioTrack ? await getFirstEncodableAudioCodec(extension === "mp4" ? ["aac", "opus"] : ["opus"], { numberOfChannels: 2, sampleRate: 48_000 }) : null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new ReverseError("The browser couldn’t make a canvas to draw on.");
  const output = new Output({ format, target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: videoCodec, bitrate, keyFrameInterval: 1 });
  output.addVideoTrack(video, { frameRate: FPS });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: 192_000 }) : null;
  if (audio) output.addAudioTrack(audio);

  const sink = new CanvasSink(track, { width, height, fit: "fill" });
  const count = Math.max(1, Math.round(length * FPS));
  await output.start();
  try {
    let written = 0;
    // From the end backwards, a batch at a time.
    for (let end = count; end > 0; end -= BATCH) {
      if (signal.aborted) throw new DOMException("Stopped.", "AbortError");
      const first = Math.max(0, end - BATCH);
      const times = Array.from({ length: end - first }, (_, i) => Math.min(to - 1e-3, from + (first + i) / FPS));
      const frames: HTMLCanvasElement[] = [];
      for await (const frame of sink.canvasesAtTimestamps(times)) {
        const copy = document.createElement("canvas");
        copy.width = width;
        copy.height = height;
        if (frame) copy.getContext("2d")?.drawImage(frame.canvas, 0, 0, width, height);
        else if (frames.length > 0) copy.getContext("2d")?.drawImage(frames.at(-1)!, 0, 0);
        frames.push(copy);
      }
      for (let i = frames.length - 1; i >= 0; i--) {
        ctx.drawImage(frames[i]!, 0, 0);
        await video.add(written / FPS, 1 / FPS);
        written++;
      }
      onProgress(Math.min(0.95, written / count));
    }
    if (audio && asset.audioTrack) {
      // The sound, read whole (a minute at most) and turned round.
      const pieces: AudioBuffer[] = [];
      for await (const { buffer } of new AudioBufferSink(asset.audioTrack).buffers(from, to)) pieces.push(buffer);
      const rate = pieces[0]?.sampleRate ?? 48_000;
      const total = Math.max(1, Math.round(length * rate));
      const channels = Math.min(2, pieces[0]?.numberOfChannels ?? 2);
      const whole = new AudioBuffer({ numberOfChannels: channels, length: total, sampleRate: rate });
      let at = 0;
      for (const piece of pieces) {
        for (let c = 0; c < channels; c++) whole.getChannelData(c).set(piece.getChannelData(Math.min(c, piece.numberOfChannels - 1)).subarray(0, Math.max(0, total - at)), at);
        at += piece.length;
        if (at >= total) break;
      }
      for (let c = 0; c < channels; c++) whole.getChannelData(c).reverse();
      // As 48 kHz stereo, which every encoder takes (a phone's 16 kHz mono isn't).
      const mix = new OfflineAudioContext(2, Math.max(1, Math.round(length * 48_000)), 48_000);
      const player = mix.createBufferSource();
      player.buffer = whole;
      player.connect(mix.destination);
      player.start();
      await audio.add(await mix.startRendering());
    }
    await output.finalize();
  } catch (err) {
    if (output.state === "started") await output.cancel().catch(() => undefined);
    throw err;
  }
  onProgress(1);
  const buffer = output.target.buffer;
  if (!buffer) throw new ReverseError("The reversed video came out empty.");
  const base = asset.media.name.replace(/\.[^.]+$/, "");
  return new File([buffer], `${base} reversed.${extension}`, { type: extension === "mp4" ? "video/mp4" : "video/webm" });
}
