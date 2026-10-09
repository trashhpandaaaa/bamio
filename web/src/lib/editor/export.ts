import {
  AudioBufferSink,
  AudioBufferSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  type WrappedCanvas,
} from "mediabunny";
import type { Asset } from "./assets";
import { canFilter, drawScene, type Picture } from "./compose";
import { duckAt, duckLine, ducks, type DuckPoint } from "./duck";
import { EDITOR_LIMITS, FORMATS, type Edit } from "./model";
import type { Envelope } from "./silence";
import { audioLength, exportProblem, fade, layout, momentAt, totalDuration } from "./timeline";

/*
 * Exporting an edit, in the browser: every frame is decoded from the user's files (WebCodecs,
 * through Mediabunny), drawn with the preview's own drawing code, and encoded into an MP4
 * (H.264 and AAC; a WebM where the browser can't encode those). The sound is mixed in pieces
 * with the Web Audio API. Nothing is uploaded and no server does any work. The file is built in
 * memory, hence the editor's 10-minute limit. What needs a plan (1080p, 60 frames a second) is
 * decided by whoever calls this: see features.ts.
 */

const SAMPLE_RATE = 48_000;
/** Sound is mixed and handed to the encoder this many seconds at a time. */
const CHUNK = 8;

export type ExportHeight = 1080 | 720;
/** Frames a second: 30, or 60 for footage that moves fast (gameplay, sport). */
export type ExportFps = 30 | 60;
export type ExportResult = { blob: Blob; extension: "mp4" | "webm"; width: number; height: number; fps: ExportFps; seconds: number; hasSound: boolean };
export class ExportError extends Error {}

/** The export's frame for a format and a resolution ("1080" and "720" name the shorter side), in even pixels. */
export function exportSize(format: Edit["format"], height: ExportHeight): { width: number; height: number } {
  const full = FORMATS[format];
  const k = height / 1080;
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(full.width), height: even(full.height) };
}

/** Bits a second for a frame size: about 8 Mbps at 1080 x 1920, 4 at 720 x 1280. Twice the frames take less than half as much again: they differ less. */
const videoBitrate = (width: number, height: number, fps: ExportFps) => Math.round(Math.max(1_500_000, width * height * 3.9) * (fps === 60 ? 1.4 : 1));

/** Whether this browser can export at all. */
export function exportSupport(): string | null {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    return "This browser can’t export video. Use a current Chrome, Edge, Firefox or Safari.";
  }
  return null;
}

const aborted = () => new DOMException("The export was stopped.", "AbortError");

/** Sound from a file between two of its moments, as one buffer (null when there's none there). */
async function readSound(sink: AudioBufferSink, from: number, to: number): Promise<AudioBuffer | null> {
  let out: AudioBuffer | null = null;
  for await (const { buffer, timestamp } of sink.buffers(from, to)) {
    const rate = buffer.sampleRate;
    out ??= new AudioBuffer({ numberOfChannels: Math.min(2, buffer.numberOfChannels), length: Math.max(1, Math.ceil((to - from) * rate) + 1), sampleRate: rate });
    if (rate !== out.sampleRate) continue;
    // The first buffer may start before `from`, the last may run past `to`.
    const offset = Math.round((timestamp - from) * rate);
    const skip = Math.max(0, -offset);
    const room = out.length - Math.max(0, offset);
    if (room <= 0 || skip >= buffer.length) continue;
    for (let ch = 0; ch < out.numberOfChannels; ch++) {
      const data = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      out.getChannelData(ch).set(data.subarray(skip, Math.min(data.length, skip + room)), Math.max(0, offset));
    }
  }
  return out;
}

/** A gain that follows an item's loudness and fades between two timeline moments (`a` to `b`, the item running `from` to `to`). */
function scheduleGain(gain: GainNode, zero: number, a: number, b: number, from: number, to: number, volume: number, fadeIn: number, fadeOut: number) {
  const length = to - from;
  const level = (t: number) => volume * fade(t - from, length, fadeIn, fadeOut);
  // Where the level changes direction: the end of the way in, the start of the way out, and where the two meet in a short item.
  const turns = [from + fadeIn, to - fadeOut, fadeIn + fadeOut > 0 ? from + (length * fadeIn) / (fadeIn + fadeOut) : from].filter((t) => t > a && t < b).sort((x, y) => x - y);
  gain.gain.setValueAtTime(level(a), Math.max(0, a - zero));
  for (const t of [...turns, b]) gain.gain.linearRampToValueAtTime(level(t), Math.max(0, t - zero));
}

/** A gain that follows the duck line (duck.ts) between two timeline moments. */
function scheduleDuck(gain: GainNode, zero: number, a: number, b: number, line: readonly DuckPoint[]) {
  gain.gain.setValueAtTime(duckAt(line, a), Math.max(0, a - zero));
  for (const point of line) if (point.t > a && point.t < b) gain.gain.linearRampToValueAtTime(point.level, point.t - zero);
  gain.gain.linearRampToValueAtTime(duckAt(line, b), Math.max(0, b - zero));
}

/** The edit's sound from `c0` to `c1` of the timeline, mixed. `duck`: the level of the sounds that duck under speech. */
async function mixSound(edit: Edit, sinks: Map<string, AudioBufferSink>, total: number, c0: number, c1: number, duck: readonly DuckPoint[]): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round((c1 - c0) * SAMPLE_RATE)), SAMPLE_RATE);
  const play = async (mediaId: string, a: number, b: number, sourceAt: (t: number) => number, speed: number, gainOf: (gain: GainNode) => void, ducked = false) => {
    const sink = sinks.get(mediaId);
    if (!sink || b - a <= 0) return;
    const buffer = await readSound(sink, sourceAt(a), sourceAt(b));
    if (!buffer) return;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = speed;
    const gain = ctx.createGain();
    gainOf(gain);
    if (ducked) {
      const under = ctx.createGain();
      scheduleDuck(under, c0, a, b, duck);
      node.connect(gain).connect(under).connect(ctx.destination);
    } else node.connect(gain).connect(ctx.destination);
    // No longer than its stretch of the timeline: the buffer has a sample or two to spare.
    node.start(a - c0, 0, (b - a) * speed);
  };
  for (const p of layout(edit)) {
    const { clip } = p;
    if (clip.muted || clip.volume === 0 || p.to <= c0 || p.from >= c1) continue;
    const a = Math.max(p.from, c0);
    const b = Math.min(p.to, c1);
    await play(clip.mediaId, a, b, (t) => clip.start + (t - p.from) * clip.speed, clip.speed, (g) => scheduleGain(g, c0, a, b, p.from, p.to, clip.volume, clip.fadeIn, clip.fadeOut));
  }
  for (const sound of edit.audio) {
    const from = sound.at;
    const to = Math.min(total, sound.at + audioLength(sound));
    if (sound.volume === 0 || to <= c0 || from >= c1) continue;
    const a = Math.max(from, c0);
    const b = Math.min(to, c1);
    // The fade out belongs to the sound's own end, even when the video ends first.
    await play(sound.mediaId, a, b, (t) => sound.start + (t - sound.at), 1, (g) => scheduleGain(g, c0, a, b, from, sound.at + audioLength(sound), sound.volume, sound.fadeIn, sound.fadeOut), Boolean(sound.duck) && duck.length > 0);
  }
  return ctx.startRendering();
}

/** Whether anything in the edit makes a sound. */
function hasSound(edit: Edit, assets: ReadonlyMap<string, Asset>): boolean {
  return (
    edit.clips.some((c) => !c.muted && c.volume > 0 && assets.get(c.mediaId)?.audioTrack) || edit.audio.some((a) => a.volume > 0 && assets.get(a.mediaId)?.audioTrack)
  );
}

/**
 * Render the edit to a video file. `onProgress` gets 0 to 1. Rejects with an AbortError when
 * `signal` fires, an ExportError (with a message for the user) when it can't be done.
 */
export async function exportEdit(
  edit: Edit,
  assets: ReadonlyMap<string, Asset>,
  options: { height: ExportHeight; fps?: ExportFps; font: string; signal: AbortSignal; onProgress: (done: number) => void },
): Promise<ExportResult> {
  const problem = exportProblem(edit) ?? exportSupport();
  if (problem) throw new ExportError(problem);
  for (const clip of edit.clips) {
    if (!assets.has(clip.mediaId)) throw new ExportError("A file of this edit is missing. Add it again, or remove its clips.");
  }
  const total = totalDuration(edit);
  const FPS: ExportFps = options.fps ?? EDITOR_LIMITS.fps;
  const { width, height } = exportSize(edit.format, options.height);
  const bitrate = videoBitrate(width, height, FPS);

  // MP4 with H.264 where the browser can encode it; otherwise a WebM.
  let format: Mp4OutputFormat | WebMOutputFormat = new Mp4OutputFormat({ fastStart: "in-memory" });
  let extension: "mp4" | "webm" = "mp4";
  let videoCodec = await getFirstEncodableVideoCodec(["avc"], { width, height, bitrate });
  if (!videoCodec) {
    format = new WebMOutputFormat();
    extension = "webm";
    videoCodec = await getFirstEncodableVideoCodec(["vp9", "vp8"], { width, height, bitrate });
  }
  if (!videoCodec) throw new ExportError("This browser can’t encode video. Use a current Chrome, Edge, Firefox or Safari.");
  const sound = hasSound(edit, assets);
  const audioCodec = sound
    ? // AAC plays everywhere an MP4 does; Opus where the browser can't encode AAC (Firefox).
      await getFirstEncodableAudioCodec(extension === "mp4" ? ["aac", "opus"] : ["opus"], { numberOfChannels: 2, sampleRate: SAMPLE_RATE })
    : null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new ExportError("The browser couldn’t make a canvas to draw on.");

  const output = new Output({ format, target: new BufferTarget() });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: 160_000 }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  // One decoder set-up per file, sized to what the frame can show.
  const frames = new Map<string, CanvasSink>();
  const sounds = new Map<string, AudioBufferSink>();
  for (const asset of assets.values()) {
    if (asset.videoTrack) {
      const most = Math.max(width, height);
      const big = Math.max(asset.videoTrack.displayWidth, asset.videoTrack.displayHeight);
      const shrink = big > most * 1.5;
      const wide = asset.videoTrack.displayWidth >= asset.videoTrack.displayHeight;
      frames.set(asset.media.id, new CanvasSink(asset.videoTrack, { poolSize: 2, ...(shrink ? (wide ? { width: Math.round(most * 1.5) } : { height: Math.round(most * 1.5) }) : {}) }));
    }
    if (asset.audioTrack) sounds.set(asset.media.id, new AudioBufferSink(asset.audioTrack));
  }

  // Music that ducks under speech needs every file's loudness, which is measured in the background after a file is opened: wait for the rest.
  let duck: DuckPoint[] = [];
  if (audioSource && ducks(edit)) {
    const heard = () => [...assets.values()].every((a) => !a.audioTrack || a.measured);
    for (let waited = 0; !heard() && waited < 120_000; waited += 250) {
      if (options.signal.aborted) throw aborted();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const envelopes = new Map<string, Envelope>();
    for (const [id, asset] of assets) if (asset.envelope) envelopes.set(id, asset.envelope);
    duck = duckLine(edit, envelopes);
  }

  const filters = canFilter();
  const count = Math.max(1, Math.ceil(total * FPS - 1e-6));
  let reader: AsyncGenerator<WrappedCanvas | null, void, unknown> | null = null;
  let readerClip: string | null = null;
  let picture: Picture | null = null;
  let mixedTo = 0;
  try {
    await output.start();
    for (let i = 0; i < count; i++) {
      if (options.signal.aborted) throw aborted();
      const time = i / FPS;
      const moment = momentAt(edit, time);
      if (moment && moment.clip.id !== readerClip) {
        // A new clip: its frames, in order, for every frame of the export it covers.
        await reader?.return();
        reader = null;
        readerClip = moment.clip.id;
        picture = null;
        const asset = assets.get(moment.clip.mediaId);
        const sink = frames.get(moment.clip.mediaId);
        if (asset?.bitmap) picture = { image: asset.bitmap, width: asset.bitmap.width, height: asset.bitmap.height };
        else if (sink) {
          const { clip, from, to } = moment;
          const times: number[] = [];
          for (let j = i; j < count && j / FPS < to; j++) times.push(Math.min(clip.end, clip.start + (j / FPS - from) * clip.speed));
          reader = sink.canvasesAtTimestamps(times);
        }
      }
      if (reader) {
        const next = await reader.next();
        const frame = next.done ? null : next.value;
        // No frame for a moment (before a file's first one): the last one stays.
        if (frame) picture = { image: frame.canvas, width: frame.canvas.width, height: frame.canvas.height };
      }
      drawScene(ctx, width, height, { edit, time, total, moment, picture, font: options.font, filters });
      await videoSource.add(time, 1 / FPS);

      // The sound, kept a little behind the picture.
      const done = (i + 1) / FPS;
      if (audioSource && (done - mixedTo >= CHUNK || i === count - 1)) {
        const to = i === count - 1 ? count / FPS : done;
        await audioSource.add(await mixSound(edit, sounds, total, mixedTo, to, duck));
        mixedTo = to;
      }
      if (i % 5 === 0) options.onProgress(Math.min(0.99, (i + 1) / count));
    }
    await reader?.return();
    if (options.signal.aborted) throw aborted();
    await output.finalize();
  } catch (err) {
    await reader?.return().catch(() => undefined);
    if (output.state === "started") await output.cancel().catch(() => undefined);
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (err instanceof ExportError) throw err;
    console.error("[bamio/editor] export failed", err);
    throw new ExportError("The export stopped part way. Try again; if it keeps happening, try 720p or a shorter edit.");
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new ExportError("The export came out empty. Try again.");
  options.onProgress(1);
  return { blob: new Blob([buffer], { type: extension === "mp4" ? "video/mp4" : "video/webm" }), extension, width, height, fps: FPS, seconds: count / FPS, hasSound: audioSource !== null };
}
