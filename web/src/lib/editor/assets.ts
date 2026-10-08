import { ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input, type InputAudioTrack, type InputVideoTrack } from "mediabunny";
import { newId, type Media } from "./model";
import type { Envelope } from "./silence";

/*
 * The files of an edit, opened in the browser: a <video> or picture for the preview, a decoder
 * for the export, and (measured in the background) thumbnails for the timeline and how loud the
 * sound is over time, for the waveform and for finding silences. Files are read where they are,
 * on the user's device.
 */

/** Values a second in a sound's envelope. */
export const ENVELOPE_RATE = 50;

export type Thumb = { time: number; image: CanvasImageSource };

export type Asset = {
  media: Media;
  file: Blob;
  url: string;
  /** The preview's player (videos). */
  video?: HTMLVideoElement;
  /** A photo, decoded. */
  bitmap?: ImageBitmap;
  /** The file as the export reads it (videos and sounds). */
  input?: Input;
  videoTrack?: InputVideoTrack;
  audioTrack?: InputAudioTrack;
  /** Filled in the background, a few at a time (videos). */
  thumbs: Thumb[];
  /** Filled in once the whole sound has been measured. */
  envelope?: Envelope;
  dispose(): void;
};

export class MediaError extends Error {}

const kindOf = (file: Blob, name: string): Media["kind"] | null => {
  const type = file.type.toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("audio/")) return "audio";
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["mp4", "mov", "m4v", "webm", "mkv"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext)) return "image";
  if (["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus"].includes(ext)) return "audio";
  return null;
};

function videoElement(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;
    // The preview's sound follows the speed, as the export's does.
    video.preservesPitch = false;
    const fail = () => reject(new MediaError("This browser can’t play that video. Try an MP4 (H.264) or a WebM."));
    video.addEventListener("loadedmetadata", () => resolve(video), { once: true });
    video.addEventListener("error", fail, { once: true });
    video.src = url;
    setTimeout(fail, 20_000);
  });
}

/**
 * Open a file for editing. `onChange` is called as its thumbnails and its loudness come in.
 * Throws MediaError (with a message for the user) for a file that can't be edited here.
 */
export async function openAsset(file: Blob, name: string, onChange: () => void, known?: Media): Promise<Asset> {
  const kind = known?.kind ?? kindOf(file, name);
  if (!kind) throw new MediaError(`“${name}” isn’t a video, a photo or a sound Bamio can edit.`);
  const url = URL.createObjectURL(file);
  const base = { id: known?.id ?? newId(), name: name.slice(0, 260), size: file.size };
  let disposed = false;
  const asset: Asset = {
    media: known ?? { ...base, kind, duration: 0, width: 0, height: 0, hasAudio: false },
    file,
    url,
    thumbs: [],
    dispose() {
      disposed = true;
      URL.revokeObjectURL(url);
      asset.video?.removeAttribute("src");
      asset.video?.load();
      asset.bitmap?.close();
      asset.input?.dispose();
    },
  };
  try {
    if (kind === "image") {
      asset.bitmap = await createImageBitmap(file).catch(() => {
        throw new MediaError(`This browser can’t open “${name}”.`);
      });
      asset.media = { ...base, kind, duration: 0, width: asset.bitmap.width, height: asset.bitmap.height, hasAudio: false };
      return asset;
    }

    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
    asset.input = input;
    if (!(await input.canRead().catch(() => false))) throw new MediaError(`Bamio can’t read “${name}”. Try an MP4, a MOV, a WebM${kind === "audio" ? ", an MP3 or a WAV" : ""}.`);
    const audioTrack = await input.getPrimaryAudioTrack();
    const hasAudio = audioTrack !== null && (await audioTrack.canDecode().catch(() => false));
    if (hasAudio) asset.audioTrack = audioTrack;
    const duration = await input.computeDuration();

    if (kind === "audio") {
      if (!hasAudio) throw new MediaError(`This browser can’t play the sound in “${name}”.`);
      asset.media = { ...base, kind, duration, width: 0, height: 0, hasAudio: true };
    } else {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) throw new MediaError(`“${name}” has no picture in it.`);
      if (!(await videoTrack.canDecode().catch(() => false))) {
        throw new MediaError(`This browser can’t decode the video in “${name}” (${videoTrack.codec ?? "an unknown format"}). Try an MP4 (H.264).`);
      }
      asset.videoTrack = videoTrack;
      asset.video = await videoElement(url);
      asset.media = { ...base, kind, duration, width: videoTrack.displayWidth, height: videoTrack.displayHeight, hasAudio };
      void measureThumbs(asset, () => disposed, onChange);
    }
    if (hasAudio) void measureEnvelope(asset, () => disposed, onChange);
    return asset;
  } catch (err) {
    asset.dispose();
    throw err instanceof MediaError ? err : new MediaError(`Bamio couldn’t open “${name}”.`);
  }
}

/** Small pictures along a video, for its clips on the timeline: up to 90, at least half a second apart. */
async function measureThumbs(asset: Asset, gone: () => boolean, onChange: () => void) {
  const track = asset.videoTrack;
  if (!track) return;
  try {
    const step = Math.max(0.5, asset.media.duration / 90);
    const times: number[] = [];
    for (let t = 0; t < asset.media.duration; t += step) times.push(t);
    const tall = track.displayHeight > track.displayWidth;
    const sink = new CanvasSink(track, tall ? { width: 72 } : { height: 72 });
    let n = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (gone()) return;
      const time = times[n++]!;
      if (!frame) continue;
      asset.thumbs.push({ time, image: frame.canvas });
      if (n % 6 === 0) onChange();
    }
    onChange();
  } catch {
    // No thumbnails: the clips show plain.
  }
}

/** How loud the file's sound is over time (see silence.ts), from every sample of it. */
async function measureEnvelope(asset: Asset, gone: () => boolean, onChange: () => void) {
  const track = asset.audioTrack;
  if (!track) return;
  try {
    const values = new Float32Array(Math.ceil(asset.media.duration * ENVELOPE_RATE) + 1);
    const sink = new AudioBufferSink(track);
    for await (const { buffer, timestamp } of sink.buffers()) {
      if (gone()) return;
      const perWindow = buffer.sampleRate / ENVELOPE_RATE;
      for (let ch = 0; ch < Math.min(2, buffer.numberOfChannels); ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = 0; i < data.length; i++) {
          const w = Math.floor(timestamp * ENVELOPE_RATE + i / perWindow);
          if (w < 0 || w >= values.length) continue;
          const v = Math.abs(data[i]!);
          if (v > values[w]!) values[w] = v;
        }
      }
    }
    asset.envelope = { rate: ENVELOPE_RATE, values };
    onChange();
  } catch {
    // No envelope: no waveform, and silences can't be found in this file.
  }
}

/** The thumbnail nearest to a moment of a video. */
export function thumbAt(thumbs: Thumb[], time: number): Thumb | null {
  let best: Thumb | null = null;
  for (const t of thumbs) if (!best || Math.abs(t.time - time) < Math.abs(best.time - time)) best = t;
  return best;
}
