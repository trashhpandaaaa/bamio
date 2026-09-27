import type { CaptionStyle, Project, Scene } from "@/lib/project/schema";
import {
  captionWords,
  isAudioCurrent,
  itemAt,
  wordTimings,
  type Timeline,
  type TimelineItem,
  type WordTiming,
} from "@/lib/project/timeline";

/*
 * Draws one frame of a project at time t. The preview player and the exporter
 * both call this, so what you preview is exactly what you export.
 * All sizes are relative to a 1080 x 1920 frame and scale with the canvas.
 */

export const EXPORT_SIZE = { width: 1080, height: 1920 } as const;

const VOLT = "#CDEA55";
const INK = "#121212";
const PAPER = "#F2F2EE";
const FADE_SEC = 0.3;
const CAPTION_LEAD_IN_SEC = 0.12;
const POP_SEC = 0.16;

export type RenderAssets = { images: Map<string, ImageBitmap> };
export type RenderContext = {
  project: Project;
  timeline: Timeline;
  assets: RenderAssets;
  fontFamily: string;
};

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
/** Overshoot ease that matches --ease-pop in the design system. */
const easePop = (x: number) => {
  const c1 = 1.56;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

/** Card colors for scenes without a picture, cycling through the brand. */
export function cardColors(index: number): { bg: string; fg: string } {
  const palette = [
    { bg: VOLT, fg: INK },
    { bg: INK, fg: PAPER },
    { bg: PAPER, fg: INK },
  ];
  return palette[index % palette.length]!;
}

export function usesImage(scene: Scene, assets: RenderAssets): boolean {
  return scene.shot !== "text-card" && assets.images.has(scene.id);
}

/** Seconds over which caption words are revealed: the voice-over length, or most of the scene. */
function speakingSpan(item: TimelineItem, project: Project): number {
  const { scene, duration } = item;
  const hasVoice = project.brief.voiceover && isAudioCurrent(scene, project.style.voice) && scene.audioDurationSec;
  const span = hasVoice ? scene.audioDurationSec! : duration * 0.8;
  return Math.max(0.2, Math.min(span, duration - CAPTION_LEAD_IN_SEC));
}

/* ------------------------------ Images ------------------------------ */

function drawKenBurns(ctx: CanvasRenderingContext2D, img: ImageBitmap, W: number, H: number, progress: number, seed: number) {
  const zoomIn = seed % 2 === 0;
  const p = easeInOutSine(clamp01(progress));
  const zoom = zoomIn ? 1 + 0.1 * p : 1.1 - 0.1 * p;
  const cover = Math.max(W / img.width, H / img.height) * zoom;
  const dw = img.width * cover;
  const dh = img.height * cover;
  // Pan within the spare margin so the image always covers the frame.
  const panX = (((seed >> 1) % 3) - 1) * (dw - W) * 0.4 * (p - 0.5);
  const panY = (((seed >> 3) % 3) - 1) * (dh - H) * 0.4 * (p - 0.5);
  ctx.drawImage(img, (W - dw) / 2 + panX, (H - dh) / 2 + panY, dw, dh);
}

function drawScrim(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.45, W, H * 0.55);
}

/* ----------------------------- Captions ----------------------------- */

type PlacedWord = WordTiming & { x: number; y: number; width: number };

/** Wrap words into centered lines. Positions are fixed so words never shift as they appear. */
function layoutWords(
  ctx: CanvasRenderingContext2D,
  timings: WordTiming[],
  maxWidth: number,
  centerX: number,
  centerY: number,
  lineHeight: number,
): PlacedWord[] {
  const space = ctx.measureText(" ").width;
  const lines: { words: (WordTiming & { width: number })[]; width: number }[] = [];
  for (const t of timings) {
    const width = ctx.measureText(t.word).width;
    const line = lines.at(-1);
    if (line && line.width + space + width <= maxWidth) {
      line.words.push({ ...t, width });
      line.width += space + width;
    } else {
      lines.push({ words: [{ ...t, width }], width });
    }
  }
  const top = centerY - ((lines.length - 1) * lineHeight) / 2;
  const placed: PlacedWord[] = [];
  lines.forEach((line, li) => {
    let x = centerX - line.width / 2;
    for (const w of line.words) {
      placed.push({ ...w, x, y: top + li * lineHeight });
      x += w.width + space;
    }
  });
  return placed;
}

function fitFontSize(ctx: CanvasRenderingContext2D, words: string[], family: string, weight: number, size: number, maxWidth: number, maxLines: number): number {
  // Shrink until the longest word fits and the caption fits in maxLines.
  let s = size;
  for (let i = 0; i < 12; i++) {
    ctx.font = `${weight} ${s}px ${family}`;
    const space = ctx.measureText(" ").width;
    let lines = 1;
    let width = 0;
    let longest = 0;
    for (const w of words) {
      const ww = ctx.measureText(w).width;
      longest = Math.max(longest, ww);
      if (width > 0 && width + space + ww > maxWidth) {
        lines++;
        width = ww;
      } else width += (width > 0 ? space : 0) + ww;
    }
    if (longest <= maxWidth && lines <= maxLines) return s;
    s *= 0.88;
  }
  return s;
}

function drawPopCaption(ctx: CanvasRenderingContext2D, rc: RenderContext, item: TimelineItem, local: number, W: number, H: number, card: { fg: string } | null) {
  const words = captionWords(item.scene.caption);
  if (words.length === 0) return;
  const u = W / 1080;
  const family = rc.fontFamily;
  const onCard = card !== null;
  const maxWidth = W * (onCard ? 0.8 : 0.84);
  const size = fitFontSize(ctx, words, family, 800, (onCard ? 118 : 78) * u, maxWidth, onCard ? 5 : 3);
  ctx.font = `800 ${size}px ${family}`;
  ctx.textBaseline = "middle";
  const timings = wordTimings(words, speakingSpan(item, rc.project)).map((t) => ({
    ...t,
    start: t.start + CAPTION_LEAD_IN_SEC,
    end: t.end + CAPTION_LEAD_IN_SEC,
  }));
  const placed = layoutWords(ctx, timings, maxWidth, W / 2, onCard ? H * 0.5 : H * 0.66, size * 1.16);
  for (const w of placed) {
    if (local < w.start) continue;
    const k = easePop(clamp01((local - w.start) / POP_SEC));
    const active = !onCard && local < w.end;
    ctx.save();
    ctx.translate(w.x + w.width / 2, w.y);
    ctx.scale(0.86 + 0.14 * k, 0.86 + 0.14 * k);
    ctx.globalAlpha = clamp01(k);
    if (active) {
      const padX = size * 0.14;
      const h = size * 1.08;
      ctx.fillStyle = VOLT;
      ctx.beginPath();
      ctx.roundRect(-w.width / 2 - padX, -h / 2, w.width + padX * 2, h, size * 0.2);
      ctx.fill();
      ctx.fillStyle = INK;
    } else if (card) {
      ctx.fillStyle = card.fg;
    } else {
      ctx.shadowColor = "rgba(0,0,0,0.55)";
      ctx.shadowBlur = 10 * u;
      ctx.shadowOffsetY = 2 * u;
      ctx.fillStyle = "#FFFFFF";
    }
    ctx.textAlign = "center";
    ctx.fillText(w.word, 0, size * 0.04);
    ctx.restore();
  }
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const word of captionWords(text)) {
    const last = lines.at(-1);
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function drawBlockCaption(ctx: CanvasRenderingContext2D, rc: RenderContext, item: TimelineItem, local: number, W: number, H: number, style: Exclude<CaptionStyle, "pop">) {
  const text = item.scene.caption.trim();
  if (!text) return;
  const u = W / 1080;
  const boxed = style === "boxed";
  const maxWidth = W * 0.8;
  const size = fitFontSize(ctx, captionWords(text), rc.fontFamily, boxed ? 800 : 700, (boxed ? 64 : 60) * u, maxWidth, 3);
  ctx.font = `${boxed ? 800 : 700} ${size}px ${rc.fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, text, maxWidth);
  const lineHeight = size * (boxed ? 1.42 : 1.2);
  const top = H * (boxed ? 0.74 : 0.8) - ((lines.length - 1) * lineHeight) / 2;
  ctx.save();
  ctx.globalAlpha = clamp01((local - CAPTION_LEAD_IN_SEC) / 0.2);
  lines.forEach((line, i) => {
    const y = top + i * lineHeight;
    if (boxed) {
      const w = ctx.measureText(line).width + size * 0.6;
      ctx.fillStyle = "rgba(18,18,18,0.88)";
      ctx.beginPath();
      ctx.roundRect(W / 2 - w / 2, y - size * 0.66, w, size * 1.32, size * 0.24);
      ctx.fill();
      ctx.fillStyle = "#FFFFFF";
    } else {
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 12 * u;
      ctx.fillStyle = "#FFFFFF";
    }
    ctx.fillText(line, W / 2, y + size * 0.04);
    ctx.shadowColor = "transparent";
  });
  ctx.restore();
}

/* ------------------------------ Scenes ------------------------------ */

function drawScene(ctx: CanvasRenderingContext2D, rc: RenderContext, item: TimelineItem, local: number, W: number, H: number) {
  const { scene } = item;
  const image = rc.assets.images.get(scene.id);
  if (image && scene.shot !== "text-card") {
    drawKenBurns(ctx, image, W, H, local / item.duration, hash(scene.id));
    drawScrim(ctx, W, H);
    if (rc.project.style.captionStyle === "pop") drawPopCaption(ctx, rc, item, local, W, H, null);
    else drawBlockCaption(ctx, rc, item, local, W, H, rc.project.style.captionStyle);
  } else {
    const card = cardColors(item.index);
    ctx.fillStyle = card.bg;
    ctx.fillRect(0, 0, W, H);
    drawPopCaption(ctx, rc, item, local, W, H, card);
  }
}

export function renderFrame(ctx: CanvasRenderingContext2D, rc: RenderContext, t: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.save();
  ctx.fillStyle = "#0A0A0A";
  ctx.fillRect(0, 0, W, H);
  const item = itemAt(rc.timeline, t);
  if (item) {
    const local = Math.min(item.duration, Math.max(0, t - item.start));
    const prev = item.index > 0 ? rc.timeline.items[item.index - 1] : undefined;
    if (rc.project.style.transition === "fade" && prev && local < FADE_SEC) {
      drawScene(ctx, rc, prev, prev.duration, W, H);
      ctx.globalAlpha = local / FADE_SEC;
      drawScene(ctx, rc, item, local, W, H);
      ctx.globalAlpha = 1;
    } else {
      drawScene(ctx, rc, item, local, W, H);
    }
  }
  ctx.restore();
}

/** The font family string next/font assigned to Bricolage, usable in ctx.font. */
export function canvasFontFamily(): string {
  if (typeof document === "undefined") return "sans-serif";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-bricolage").trim();
  return value || "system-ui, sans-serif";
}

export async function ensureCanvasFont(family: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    await Promise.all([document.fonts.load(`800 48px ${family}`), document.fonts.load(`700 48px ${family}`)]);
  } catch {
    // Fall back to whatever is available; rendering still works.
  }
}
