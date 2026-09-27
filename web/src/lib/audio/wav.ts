/**
 * WAV helpers. Gemini TTS returns either a complete WAV file or raw 16-bit
 * little-endian PCM (mime type like "audio/L16;codec=pcm;rate=24000").
 * Everything is normalised to WAV so browsers can decode it.
 */

export type PcmFormat = { sampleRate: number; channels: number; bitsPerSample: number };

const DEFAULT_FORMAT: PcmFormat = { sampleRate: 24_000, channels: 1, bitsPerSample: 16 };

export function isWav(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45 // WAVE
  );
}

/** Read sample rate and channel count from a PCM mime type, falling back to 24 kHz mono. */
export function formatFromMime(mimeType: string): PcmFormat {
  const rate = /rate=(\d+)/i.exec(mimeType)?.[1];
  const channels = /channels=(\d+)/i.exec(mimeType)?.[1];
  return {
    sampleRate: rate ? Number(rate) : DEFAULT_FORMAT.sampleRate,
    channels: channels ? Number(channels) : DEFAULT_FORMAT.channels,
    bitsPerSample: 16,
  };
}

export function pcmToWav(pcm: Uint8Array, format: PcmFormat = DEFAULT_FORMAT): Uint8Array {
  const { sampleRate, channels, bitsPerSample } = format;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataLength = pcm.length - (pcm.length % blockAlign);
  const out = new Uint8Array(44 + dataLength);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  ascii(36, "data");
  view.setUint32(40, dataLength, true);
  out.set(pcm.subarray(0, dataLength), 44);
  return out;
}

/** Duration in seconds of a WAV file, found by walking its chunks. Returns 0 if unreadable. */
export function wavDuration(bytes: Uint8Array): number {
  if (!isWav(bytes)) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
    const size = view.getUint32(offset + 4, true);
    if (id === "fmt " && offset + 20 <= bytes.length) byteRate = view.getUint32(offset + 16, true);
    if (id === "data") {
      const available = Math.min(size, bytes.length - offset - 8);
      return byteRate > 0 ? available / byteRate : 0;
    }
    offset += 8 + size + (size % 2);
  }
  return 0;
}

/** Normalise any Gemini audio payload to WAV and report its duration. */
export function toWav(bytes: Uint8Array, mimeType: string): { wav: Uint8Array; durationSec: number } {
  const wav = isWav(bytes) ? bytes : pcmToWav(bytes, formatFromMime(mimeType));
  return { wav, durationSec: wavDuration(wav) };
}
