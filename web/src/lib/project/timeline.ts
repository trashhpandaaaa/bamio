import { LIMITS, type Project, type Scene } from "@/lib/project/schema";

/** Extra hold after a voice-over line ends, so cuts never clip the last word. */
export const VOICE_TAIL_SEC = 0.3;

export function audioKeyFor(text: string, voice: string): string {
  return `${voice}|${text.trim()}`;
}

/** True when the scene has a voice-over clip made from its current text and the current voice. */
export function isAudioCurrent(scene: Scene, voice: string): boolean {
  return Boolean(scene.audioId) && scene.audioKey === audioKeyFor(scene.voiceover, voice);
}

/** How long a scene plays: its set duration, stretched if its voice-over is longer. */
export function effectiveDuration(scene: Scene, project: Pick<Project, "brief" | "style">): number {
  const base = scene.durationSec;
  if (!project.brief.voiceover || !isAudioCurrent(scene, project.style.voice) || !scene.audioDurationSec) return base;
  return Math.max(base, Math.round((scene.audioDurationSec + VOICE_TAIL_SEC) * 100) / 100);
}

export type TimelineItem = { scene: Scene; index: number; start: number; end: number; duration: number };
export type Timeline = { items: TimelineItem[]; total: number };

export function buildTimeline(project: Pick<Project, "scenes" | "brief" | "style">): Timeline {
  let t = 0;
  const items = project.scenes.map((scene, index) => {
    const duration = effectiveDuration(scene, project);
    const item = { scene, index, start: t, end: t + duration, duration };
    t += duration;
    return item;
  });
  return { items, total: t };
}

/** The item playing at time t (clamped to the timeline). Undefined only for an empty timeline. */
export function itemAt(timeline: Timeline, t: number): TimelineItem | undefined {
  const { items } = timeline;
  if (items.length === 0) return undefined;
  if (t <= 0) return items[0];
  let lo = 0;
  let hi = items.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (items[mid]!.start <= t) lo = mid;
    else hi = mid - 1;
  }
  return items[lo];
}

export function captionWords(caption: string): string[] {
  return caption.trim().split(/\s+/).filter(Boolean);
}

export type WordTiming = { word: string; start: number; end: number };

/**
 * Spread words across `span` seconds, weighted by length so long words stay up longer.
 * Every word gets a start strictly inside the span, and the last word ends at the span's end.
 */
export function wordTimings(words: string[], span: number): WordTiming[] {
  if (words.length === 0 || span <= 0) return [];
  const weights = words.map((w) => w.length + 2);
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  return words.map((word, i) => {
    const d = (weights[i]! / sum) * span;
    const timing = { word, start: t, end: t + d };
    t += d;
    return timing;
  });
}

/**
 * Scale durations so they add up to `target` (within rounding), keeping each in range.
 * Used when the AI's scene lengths drift from the requested video length.
 */
export function fitDurations(durations: number[], target: number, min: number = LIMITS.sceneMin, max: number = LIMITS.sceneMax): number[] {
  if (durations.length === 0) return [];
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const safe = durations.map((d) => (Number.isFinite(d) && d > 0 ? d : 1));
  const sum = safe.reduce((a, b) => a + b, 0);
  const reachable = Math.min(max * safe.length, Math.max(min * safe.length, target));
  if (Math.abs(sum - reachable) / reachable <= 0.1) return safe.map((d) => Math.round(clamp(d) * 10) / 10);
  const scaled = safe.map((d) => clamp((d / sum) * reachable));
  return scaled.map((d) => Math.round(d * 10) / 10);
}

/** mm:ss.cc, the timecode style used in the studio. */
export function formatTimecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const cs = Math.floor(s * 100 + 1e-6);
  const mm = Math.floor(cs / 6000);
  const ss = Math.floor((cs % 6000) / 100);
  const cc = cs % 100;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

/** m:ss, for durations on cards. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
