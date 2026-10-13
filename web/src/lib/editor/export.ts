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
  StreamTarget,
  WebMOutputFormat,
  type StreamTargetChunk,
  type WrappedCanvas,
} from "mediabunny";
import type { Asset } from "./assets";
import { canFilter, drawScene, type Fonts, type Picture } from "./compose";
import { duckAt, duckLine, ducks, type DuckPoint } from "./duck";
import { blocksOf, integratedLoudness, kState, kWeightedPieces, levelGain } from "./loudness";
import { EDITOR_LIMITS, FORMATS, type Edit, type Overlay } from "./model";
import type { Envelope } from "./silence";
import { audioLength, exportProblem, fade, layout, momentAt, overlayLength, overlayMomentAt, totalDuration, transitionAt } from "./timeline";

/*
 * Exporting an edit, in the browser: every frame is decoded from the user's files (WebCodecs,
 * through Mediabunny), drawn with the preview's own drawing code, and encoded into an MP4
 * (H.264 and AAC; a WebM where the browser can't encode those). The sound is mixed in pieces
 * with the Web Audio API. Nothing is uploaded and no server does any work. The file is built in
 * memory (hence the editor's 10-minute limit), or written straight to a file on disk the person
 * chose (`disk`: up to an hour). What needs a plan (1080p, 4K, 60 frames a second, levelling,
 * disk) is decided by whoever calls this: see features.ts.
 */

const SAMPLE_RATE = 48_000;
/** Sound is mixed and handed to the encoder this many seconds at a time. */
const CHUNK = 8;

/** The frame's shorter side: 720, 1080 (Full HD) or 2160 (4K). */
export type ExportHeight = 720 | 1080 | 2160;
/** Frames a second: 30, or 60 for footage that moves fast (gameplay, sport). */
export type ExportFps = 30 | 60;
/** The finished file: in memory (`blob`), or already on disk (`blob` null). */
export type ExportResult = { blob: Blob | null; extension: "mp4" | "webm"; width: number; height: number; fps: ExportFps; seconds: number; hasSound: boolean };
export class ExportError extends Error {}

/** The export's frame for a format and a resolution (it names the shorter side), in even pixels. */
export function exportSize(format: Edit["format"], height: ExportHeight): { width: number; height: number } {
  const full = FORMATS[format];
  const k = height / 1080;
  const even = (n: number) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(full.width), height: even(full.height) };
}

/** Bits a second for a frame size: about 8 Mbps at 1080 x 1920, 4 at 720 x 1280, 32 at 4K. Twice the frames take less than half as much again: they differ less. */
const videoBitrate = (width: number, height: number, fps: ExportFps) => Math.round(Math.max(1_500_000, width * height * 3.9) * (fps === 60 ? 1.4 : 1));

/** Whether this browser can export at all. */
export function exportSupport(): string | null {
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") {
    return "This browser can’t export video. Use a current Chrome, Edge, Firefox or Safari.";
  }
  return null;
}

/** Whether this browser can write an export straight to a file it asks for (Chrome and Edge). */
export const canSaveToDisk = () => typeof window !== "undefined" && "showSaveFilePicker" in window;

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

type Mix = { duck: readonly DuckPoint[]; /** Loudness levelling's gain, with a limiter after it; 1 for none. */ level: number };

/** The edit's sound from `c0` to `c1` of the timeline, mixed: the clips, the sounds, and the video layers with their sound on. */
async function mixSound(edit: Edit, sinks: Map<string, AudioBufferSink>, total: number, c0: number, c1: number, mix: Mix): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round((c1 - c0) * SAMPLE_RATE)), SAMPLE_RATE);
  let out: AudioNode = ctx.destination;
  if (mix.level !== 1) {
    // Levelled: everything through one gain, then a limiter so the peaks it raises don't clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.08;
    const master = ctx.createGain();
    master.gain.value = mix.level;
    master.connect(limiter).connect(ctx.destination);
    out = master;
  }
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
      scheduleDuck(under, c0, a, b, mix.duck);
      node.connect(gain).connect(under).connect(out);
    } else node.connect(gain).connect(out);
    // No longer than its stretch of the timeline: the buffer has a sample or two to spare.
    node.start(a - c0, 0, (b - a) * speed);
  };
  for (const p of layout(edit)) {
    const { clip } = p;
    // A freeze frame is silent.
    if (clip.muted || clip.freeze || clip.volume === 0 || p.to <= c0 || p.from >= c1) continue;
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
    await play(sound.mediaId, a, b, (t) => sound.start + (t - sound.at), 1, (g) => scheduleGain(g, c0, a, b, from, sound.at + audioLength(sound), sound.volume, sound.fadeIn, sound.fadeOut), Boolean(sound.duck) && mix.duck.length > 0);
  }
  for (const layer of edit.overlays) {
    const from = layer.at;
    const to = Math.min(total, layer.at + overlayLength(layer));
    if (layer.muted || layer.volume === 0 || to <= c0 || from >= c1) continue;
    const a = Math.max(from, c0);
    const b = Math.min(to, c1);
    await play(layer.mediaId, a, b, (t) => layer.start + (t - layer.at) * layer.speed, layer.speed, (g) => g.gain.setValueAtTime(layer.volume, 0));
  }
  return ctx.startRendering();
}

/** Whether anything in the edit makes a sound. */
function hasSound(edit: Edit, assets: ReadonlyMap<string, Asset>): boolean {
  const heard = (id: string) => Boolean(assets.get(id)?.audioTrack);
  return (
    edit.clips.some((c) => !c.muted && !c.freeze && c.volume > 0 && heard(c.mediaId)) ||
    edit.audio.some((a) => a.volume > 0 && heard(a.mediaId)) ||
    edit.overlays.some((o) => !o.muted && o.volume > 0 && heard(o.mediaId))
  );
}

/** A picture's pixels copied out of a decoder's canvas, which it will draw the next frame into. */
function keep(picture: Picture): Picture {
  if (!(picture.image instanceof HTMLCanvasElement) && !(typeof OffscreenCanvas !== "undefined" && picture.image instanceof OffscreenCanvas)) return picture;
  const copy = document.createElement("canvas");
  copy.width = picture.image.width;
  copy.height = picture.image.height;
  copy.getContext("2d")?.drawImage(picture.image, 0, 0);
  return { image: copy, width: picture.width, height: picture.height };
}

/** A decoder for a file, sized to what an export of this size can show. */
function sinkFor(asset: Asset, width: number, height: number): CanvasSink | null {
  const track = asset.videoTrack;
  if (!track) return null;
  const most = Math.max(width, height);
  const big = Math.max(track.displayWidth, track.displayHeight);
  const wide = track.displayWidth >= track.displayHeight;
  return new CanvasSink(track, { poolSize: 2, ...(big > most * 1.5 ? (wide ? { width: Math.round(most * 1.5) } : { height: Math.round(most * 1.5) }) : {}) });
}

/** The loudness of the edit's mix, measured before it's encoded (loudness.ts): its levelling gain. */
async function measureLevel(edit: Edit, sinks: Map<string, AudioBufferSink>, total: number, duck: readonly DuckPoint[], signal: AbortSignal): Promise<number> {
  const state = kState(2);
  const pieces: number[] = [];
  for (let c0 = 0; c0 < total; c0 += CHUNK) {
    if (signal.aborted) throw aborted();
    const buffer = await mixSound(edit, sinks, total, c0, Math.min(total, c0 + CHUNK), { duck, level: 1 });
    pieces.push(...kWeightedPieces([buffer.getChannelData(0), buffer.getChannelData(1)], state));
  }
  return levelGain(integratedLoudness(blocksOf(pieces)));
}

export type ExportOptions = {
  height: ExportHeight;
  fps?: ExportFps;
  fonts: Fonts;
  signal: AbortSignal;
  onProgress: (done: number) => void;
  /** A file on disk to write to as the export goes (showSaveFilePicker), instead of memory. */
  disk?: WritableStream<StreamTargetChunk>;
};

/**
 * Render the edit to a video file. `onProgress` gets 0 to 1. Rejects with an AbortError when
 * `signal` fires, an ExportError (with a message for the user) when it can't be done.
 */
export async function exportEdit(edit: Edit, assets: ReadonlyMap<string, Asset>, options: ExportOptions): Promise<ExportResult> {
  const problem = exportProblem(edit, Boolean(options.disk)) ?? exportSupport();
  if (problem) throw new ExportError(problem);
  for (const id of [...edit.clips.map((c) => c.mediaId), ...edit.overlays.map((o) => o.mediaId)]) {
    if (!assets.has(id)) throw new ExportError("A file of this edit is missing. Add it again, or remove what uses it.");
  }
  const total = totalDuration(edit);
  const FPS: ExportFps = options.fps ?? EDITOR_LIMITS.fps;
  const { width, height } = exportSize(edit.format, options.height);
  const bitrate = videoBitrate(width, height, FPS);

  // MP4 with H.264 where the browser can encode it; otherwise a WebM. Written to disk, the MP4's index goes at the end.
  let format: Mp4OutputFormat | WebMOutputFormat = new Mp4OutputFormat({ fastStart: options.disk ? false : "in-memory" });
  let extension: "mp4" | "webm" = "mp4";
  let videoCodec = await getFirstEncodableVideoCodec(["avc"], { width, height, bitrate });
  if (!videoCodec) {
    format = new WebMOutputFormat();
    extension = "webm";
    videoCodec = await getFirstEncodableVideoCodec(["vp9", "vp8"], { width, height, bitrate });
  }
  if (!videoCodec) {
    throw new ExportError(options.height === 2160 ? "This browser can’t encode 4K video. Try 1080p." : "This browser can’t encode video. Use a current Chrome, Edge, Firefox or Safari.");
  }
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

  const target = options.disk ? new StreamTarget(options.disk, { chunked: true }) : new BufferTarget();
  const output = new Output({ format, target });
  const videoSource = new CanvasSource(canvas, { codec: videoCodec, bitrate, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: FPS });
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: 160_000 }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  // One decoder set-up per file for the main track, sized to what the frame can show; layers get their own.
  const frames = new Map<string, CanvasSink>();
  const sounds = new Map<string, AudioBufferSink>();
  for (const asset of assets.values()) {
    const sink = sinkFor(asset, width, height);
    if (sink) frames.set(asset.media.id, sink);
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
  // Levelling: the whole mix is heard once first, to know how loud it is.
  const level = audioSource && edit.level ? await measureLevel(edit, sounds, total, duck, options.signal) : 1;

  const filters = canFilter();
  const count = Math.max(1, Math.ceil(total * FPS - 1e-6));
  let reader: AsyncGenerator<WrappedCanvas | null, void, unknown> | null = null;
  let readerClip: string | null = null;
  let picture: Picture | null = null;
  /** The clip before's last frame, kept for a transition into the one now. */
  let previous: Picture | null = null;
  /** Each video layer showing: its own decoder's frames, in order, and the frame now. */
  const layerReaders = new Map<string, { reader: AsyncGenerator<WrappedCanvas | null, void, unknown>; picture: Picture | null }>();
  let mixedTo = 0;
  const stopLayer = async (id: string) => {
    await layerReaders.get(id)?.reader.return();
    layerReaders.delete(id);
  };
  try {
    await output.start();
    for (let i = 0; i < count; i++) {
      if (options.signal.aborted) throw aborted();
      const time = i / FPS;
      const moment = momentAt(edit, time);
      if (moment && moment.clip.id !== readerClip) {
        // A new clip. A transition into it starts from the last frame of the one before.
        previous = picture && transitionAt(edit, moment) ? keep(picture) : null;
        await reader?.return();
        reader = null;
        readerClip = moment.clip.id;
        picture = null;
        const asset = assets.get(moment.clip.mediaId);
        const sink = frames.get(moment.clip.mediaId);
        if (asset?.bitmap) picture = { image: asset.bitmap, width: asset.bitmap.width, height: asset.bitmap.height };
        else if (sink && moment.clip.freeze) {
          // A freeze frame: one frame, held.
          const still = await sink.getCanvas(moment.clip.start);
          if (still) picture = keep({ image: still.canvas, width: still.canvas.width, height: still.canvas.height });
        } else if (sink) {
          // Its frames, in order, for every frame of the export it covers.
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

      // The layers showing now.
      const layers: { overlay: Overlay; picture: Picture | null }[] = [];
      for (const overlay of edit.overlays) {
        const at = overlayMomentAt(overlay, time);
        if (!at) {
          if (layerReaders.has(overlay.id)) await stopLayer(overlay.id);
          continue;
        }
        const asset = assets.get(overlay.mediaId);
        if (asset?.bitmap) {
          layers.push({ overlay, picture: { image: asset.bitmap, width: asset.bitmap.width, height: asset.bitmap.height } });
          continue;
        }
        let state = layerReaders.get(overlay.id);
        if (!state && asset) {
          const sink = sinkFor(asset, width, height);
          if (sink) {
            const times: number[] = [];
            for (let j = i; j < count && overlayMomentAt(overlay, j / FPS); j++) times.push(overlayMomentAt(overlay, j / FPS)!.source);
            state = { reader: sink.canvasesAtTimestamps(times), picture: null };
            layerReaders.set(overlay.id, state);
          }
        }
        if (state) {
          const next = await state.reader.next();
          const frame = next.done ? null : next.value;
          if (frame) state.picture = { image: frame.canvas, width: frame.canvas.width, height: frame.canvas.height };
        }
        layers.push({ overlay, picture: state?.picture ?? null });
      }

      drawScene(ctx, width, height, { edit, time, total, moment, picture, previous, layers, fonts: options.fonts, filters });
      await videoSource.add(time, 1 / FPS);

      // The sound, kept a little behind the picture.
      const done = (i + 1) / FPS;
      if (audioSource && (done - mixedTo >= CHUNK || i === count - 1)) {
        const to = i === count - 1 ? count / FPS : done;
        await audioSource.add(await mixSound(edit, sounds, total, mixedTo, to, { duck, level }));
        mixedTo = to;
      }
      if (i % 5 === 0) options.onProgress(Math.min(0.99, (i + 1) / count));
    }
    await reader?.return();
    for (const id of [...layerReaders.keys()]) await stopLayer(id);
    if (options.signal.aborted) throw aborted();
    await output.finalize();
  } catch (err) {
    await reader?.return().catch(() => undefined);
    for (const id of [...layerReaders.keys()]) await stopLayer(id).catch(() => undefined);
    if (output.state === "started") await output.cancel().catch(() => undefined);
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    if (err instanceof ExportError) throw err;
    console.error("[bamio/editor] export failed", err);
    throw new ExportError("The export stopped part way. Try again; if it keeps happening, try a lower quality or a shorter edit.");
  }
  options.onProgress(1);
  const base = { extension, width, height, fps: FPS, seconds: count / FPS, hasSound: audioSource !== null };
  if (options.disk) return { blob: null, ...base };
  const buffer = (target as BufferTarget).buffer;
  if (!buffer) throw new ExportError("The export came out empty. Try again.");
  return { blob: new Blob([buffer], { type: extension === "mp4" ? "video/mp4" : "video/webm" }), ...base };
}
