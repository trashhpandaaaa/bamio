/*
 * A WAV file from sound samples. Voiceovers recorded in the editor are kept as WAV: what a
 * browser's recorder writes (WebM without a length or an index) can't be sought in reliably,
 * and a voiceover has to start anywhere.
 */

/** 16-bit PCM WAV, one channel (the channels of `buffer` averaged). */
export function wavFrom(buffer: AudioBuffer): Blob {
  const length = buffer.length;
  const mono = new Float32Array(length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) mono[i]! += data[i]! / buffer.numberOfChannels;
  }
  return wavOfSamples(mono, buffer.sampleRate);
}

export function wavOfSamples(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  bytes.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  bytes.setUint32(16, 16, true);
  bytes.setUint16(20, 1, true); // PCM
  bytes.setUint16(22, 1, true); // one channel
  bytes.setUint32(24, sampleRate, true);
  bytes.setUint32(28, sampleRate * 2, true);
  bytes.setUint16(32, 2, true);
  bytes.setUint16(34, 16, true);
  text(36, "data");
  bytes.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    bytes.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
  }
  return new Blob([bytes.buffer], { type: "audio/wav" });
}
