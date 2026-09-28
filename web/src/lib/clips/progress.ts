/* Parsers for yt-dlp and ffmpeg progress output (pure, unit-tested). */

/** yt-dlp is run with --progress-template "download:BAMIO %(progress._percent_str)s". Returns 0..1 or null. */
export function parseYtdlpProgress(line: string): number | null {
  const m = /BAMIO\s+([\d.]+)%/.exec(line);
  if (!m) return null;
  const pct = Number.parseFloat(m[1]!);
  return Number.isFinite(pct) ? Math.min(1, Math.max(0, pct / 100)) : null;
}

/** ffmpeg -progress pipe:1 emits "out_time_us=12345678" (or out_time_ms, also in microseconds). Returns seconds. */
export function parseFfmpegProgress(line: string): number | null {
  const m = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
  if (!m) return null;
  const us = Number(m[1]);
  return Number.isFinite(us) ? us / 1_000_000 : null;
}
