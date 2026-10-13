import { wordGap } from "@/lib/clips/logic";
import { captionAt } from "./captions";
import { keyOut } from "./chroma";
import { INK, lookFilter, type CaptionStyleId, type Clip, type Edit, type FontId, type Overlay, type Rect, type TextLayer } from "./model";
import { clipLength, fade, lastFrameAt, motionScale, textPose, trackAt, transitionAt, type Moment } from "./timeline";

/*
 * Drawing one frame of an edit on a canvas: the main track's picture (cropped or fitted into
 * its place on the frame, turned, flipped, coloured, keyed, faded, coming in through a
 * transition), its facecam, the layers over it, the captions, the text and the progress bar.
 * The preview and the export both draw with this, at their own sizes, so what's exported is
 * what was seen: every measure is a share of the frame, never a pixel count.
 */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A frame of video, or a photo, with its size as shown (after the file's own rotation). */
export type Picture = { image: CanvasImageSource; width: number; height: number };

/** A typeface as the canvas names it, and the weight it's drawn at. */
export type Face = { family: string; weight: number };
export type Fonts = Partial<Record<FontId, Face>>;

export type Scene = {
  edit: Edit;
  time: number;
  total: number;
  /** What the main track shows now, and its picture (null while it's loading: the frame stays black). */
  moment: Moment | null;
  picture: Picture | null;
  /** The clip before's last frame, while a transition into this one plays (null while it loads: the transition is skipped). */
  previous?: Picture | null;
  /** The layers showing now, the last on top, each with its picture (null while it loads). */
  layers?: { overlay: Overlay; picture: Picture | null }[];
  /** The typefaces text and captions may use; `bricolage` at least. */
  fonts: Fonts;
  /** Whether the canvas can filter (see canFilter): looks need it. */
  filters: boolean;
  /** The text layer being worked on (the preview's selection; never set for an export). The frame around it is the page's, not the picture's: see preview.tsx. */
  selectedText?: string | null;
  /** The preview, paused: the selected text is shown whole, wherever its animation is, so it can be seen while it's worked on. */
  paused?: boolean;
};

/** Where a text layer was drawn, in canvas pixels: for picking it up with the pointer. */
export type TextBox = { id: string; x: number; y: number; width: number; height: number };

/** Canvas filters (looks, the blurred backdrop's softness) exist in Chrome, Edge and Firefox, not in every Safari. */
export function canFilter(): boolean {
  return typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;
}

const SYSTEM: Face = { family: "system-ui, sans-serif", weight: 800 };
const faceOf = (fonts: Fonts, id: FontId | undefined): Face => (id ? fonts[id] : undefined) ?? fonts.bricolage ?? SYSTEM;

let scratch: HTMLCanvasElement | null = null;

function drawPicture(ctx: Ctx, picture: Picture, clip: Clip, cx: number, cy: number, width: number, height: number) {
  const quarter = clip.rotate === 90 || clip.rotate === 270;
  ctx.save();
  ctx.translate(cx, cy);
  // The flip is across the frame, whichever way the picture is turned.
  if (clip.flip) ctx.scale(-1, 1);
  if (clip.rotate) ctx.rotate((clip.rotate * Math.PI) / 180);
  const w = quarter ? height : width;
  const h = quarter ? width : height;
  ctx.drawImage(picture.image, -w / 2, -h / 2, w, h);
  ctx.restore();
}

/** Behind a picture that doesn't fill the frame: a colour, or a soft dark copy of the picture itself (black behind a keyed one). */
function drawBackdrop(ctx: Ctx, W: number, H: number, picture: Picture, clip: Clip, sw: number, sh: number, scene: Scene) {
  if (scene.edit.background !== "blur" || clip.key) {
    ctx.fillStyle = scene.edit.background === "blur" ? "#000000" : scene.edit.background;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  // Drawn tiny, then stretched: the stretch does most of the blurring, for next to nothing.
  scratch ??= document.createElement("canvas");
  const k = 40 / Math.max(W, H);
  const w = Math.max(2, Math.round(W * k));
  const h = Math.max(2, Math.round(H * k));
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const small = scratch.getContext("2d");
  if (!small) return;
  const cover = Math.max(w / sw, h / sh) * 1.12;
  if (scene.filters) small.filter = "blur(1.5px)";
  drawPicture(small, picture, clip, w / 2, h / 2, sw * cover, sh * cover);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(scratch, 0, 0, W, H);
  ctx.fillStyle = "rgb(0 0 0 / 0.42)";
  ctx.fillRect(0, 0, W, H);
}

/** A rectangle of shares as canvas pixels. */
const px = (r: Rect, W: number, H: number) => ({ x: r.x * W, y: r.y * H, w: r.w * W, h: r.h * H });

/** A rounded rectangle's path. */
function roundPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (r > 0 && "roundRect" in ctx) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

/**
 * The part `crop` of a picture, filling `dest` (cut to its shape, centred), with rounded
 * corners, see-through and a border as asked: layers and facecams.
 */
function drawCover(ctx: Ctx, picture: Picture, crop: Rect, dest: { x: number; y: number; w: number; h: number }, opts: { radius: number; opacity: number; border: boolean; filter: string; W: number }) {
  const cw = crop.w * picture.width;
  const ch = crop.h * picture.height;
  if (cw <= 0 || ch <= 0 || dest.w <= 0 || dest.h <= 0) return;
  const scale = Math.max(dest.w / cw, dest.h / ch);
  const sw = dest.w / scale;
  const sh = dest.h / scale;
  const sx = crop.x * picture.width + (cw - sw) / 2;
  const sy = crop.y * picture.height + (ch - sh) / 2;
  const r = opts.radius * Math.min(dest.w, dest.h);
  ctx.save();
  ctx.globalAlpha *= opts.opacity;
  roundPath(ctx, dest.x, dest.y, dest.w, dest.h, r);
  ctx.clip();
  if (opts.filter) ctx.filter = opts.filter;
  ctx.drawImage(picture.image, sx, sy, sw, sh, dest.x, dest.y, dest.w, dest.h);
  ctx.restore();
  if (opts.border) {
    ctx.save();
    ctx.globalAlpha *= opts.opacity;
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = Math.max(2, opts.W * 0.006);
    roundPath(ctx, dest.x, dest.y, dest.w, dest.h, r);
    ctx.stroke();
    ctx.restore();
  }
}

/** A picture with its key colour taken out, when the item has a green screen. */
function keyed(picture: Picture, key: Clip["key"]): Picture {
  if (!key) return picture;
  const out = keyOut(picture.image, picture.width, picture.height, key);
  return out ? { image: out, width: picture.width, height: picture.height } : picture;
}

/**
 * One clip's frame: what's behind it, its picture in its place on the frame (the whole frame,
 * or its layout's box), and its facecam. `extraFilter`: a transition's blur.
 */
function drawClipFrame(ctx: Ctx, W: number, H: number, scene: Scene, clip: Clip, picture: Picture, local: number, source: number, extraFilter = "") {
  const quarter = clip.rotate === 90 || clip.rotate === 270;
  const sw = quarter ? picture.height : picture.width;
  const sh = quarter ? picture.width : picture.height;
  const box = clip.box ? px(clip.box, W, H) : { x: 0, y: 0, w: W, h: H };
  if (clip.fit === "fit" || clip.box || clip.key) drawBackdrop(ctx, W, H, picture, clip, sw, sh, scene);
  const base = clip.fit === "fit" ? Math.min(box.w / sw, box.h / sh) : Math.max(box.w / sw, box.h / sh);
  const scale = base * clip.zoom * motionScale(clip, local);
  const width = sw * scale;
  const height = sh * scale;
  // Auto-reframe's path, or where it was put by hand. -1 shows the picture's left (or top) edge, 1 its right (or bottom).
  const at = clip.track?.length ? trackAt(clip.track, source) : { x: clip.x, y: clip.y };
  const cx = box.x + box.w / 2 - (at.x * Math.max(0, width - box.w)) / 2;
  const cy = box.y + box.h / 2 - (at.y * Math.max(0, height - box.h)) / 2;
  const look = scene.filters ? lookFilter(clip) : "";
  const filter = [look, extraFilter].filter(Boolean).join(" ");
  ctx.save();
  if (clip.box) {
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
  }
  if (filter) ctx.filter = filter;
  drawPicture(ctx, keyed(picture, clip.key), clip, cx, cy, width, height);
  ctx.restore();
  // The facecam: another part of the same picture, in its own place.
  if (clip.cam) drawCover(ctx, picture, clip.cam.crop, px(clip.cam.box, W, H), { radius: clip.cam.radius, opacity: 1, border: false, filter, W });
}

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/** The clip coming in over the one going out (`previous`: its last frame), by the transition's kind. */
function drawTransition(ctx: Ctx, W: number, H: number, scene: Scene, moment: Moment, picture: Picture, previous: Picture, step: NonNullable<ReturnType<typeof transitionAt>>) {
  const before = step.previous.clip;
  const p = step.progress;
  const e = easeInOut(p);
  const side = (clip: Clip, pic: Picture, local: number, source: number, how: { dx?: number; scale?: number; alpha?: number; blur?: number }) => {
    ctx.save();
    ctx.globalAlpha = how.alpha ?? 1;
    const s = how.scale ?? 1;
    ctx.translate(W / 2 + (how.dx ?? 0), H / 2);
    ctx.scale(s, s);
    ctx.translate(-W / 2, -H / 2);
    drawClipFrame(ctx, W, H, scene, clip, pic, local, source, how.blur && scene.filters ? `blur(${how.blur.toFixed(1)}px)` : "");
    ctx.restore();
  };
  const out = () => side(before, previous, clipLength(before), lastFrameAt(before), {});
  const into = (how: Parameters<typeof side>[4]) => side(moment.clip, picture, moment.local, moment.source, how);
  switch (step.transition.kind) {
    case "fade":
      out();
      into({ alpha: e });
      break;
    case "slide":
      side(before, previous, clipLength(before), lastFrameAt(before), { dx: -e * W });
      into({ dx: (1 - e) * W });
      break;
    case "zoom":
      side(before, previous, clipLength(before), lastFrameAt(before), { scale: 1 + 0.25 * e });
      into({ scale: 1.25 - 0.25 * e, alpha: e });
      break;
    case "whip": {
      const blur = Math.sin(Math.PI * p) * W * 0.03;
      const fast = p < 0.5 ? 16 * p ** 5 : 1 - (-2 * p + 2) ** 5 / 2;
      side(before, previous, clipLength(before), lastFrameAt(before), { dx: -fast * W, blur });
      into({ dx: (1 - fast) * W, blur });
      break;
    }
    case "flash":
      if (p < 0.5) out();
      else into({});
      ctx.fillStyle = `rgb(255 255 255 / ${(1 - Math.abs(2 * p - 1)).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      break;
  }
}

/** A layer over the main track: its picture's crop in its box. */
function drawLayer(ctx: Ctx, W: number, H: number, overlay: Overlay, picture: Picture) {
  drawCover(ctx, keyed(picture, overlay.key), overlay.crop, px(overlay.box, W, H), { radius: overlay.radius, opacity: overlay.opacity, border: overlay.border, filter: "", W });
}

/** Text broken into lines: at its own line breaks, and wherever a line would pass `maxWidth`. */
export function wrapLines(measure: (text: string) => number, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (!line || measure(next) <= maxWidth) {
        line = next;
        continue;
      }
      out.push(line);
      line = word;
    }
    // One word wider than the frame is broken wherever it has to be.
    while (measure(line) > maxWidth && [...line].length > 1) {
      const chars = [...line];
      let n = chars.length - 1;
      while (n > 1 && measure(chars.slice(0, n).join("")) > maxWidth) n--;
      out.push(chars.slice(0, n).join(""));
      line = chars.slice(n).join("");
    }
    out.push(line);
  }
  return out;
}

/** Whether a colour is dark enough to need light text on it. */
function isDark(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 110;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  roundPath(ctx, x, y, w, h, r);
  ctx.fill();
}

function drawText(ctx: Ctx, W: number, H: number, layer: TextLayer, scene: Scene): TextBox | null {
  if (!layer.text.trim()) return null;
  const size = Math.max(6, layer.size * W);
  const face = faceOf(scene.fonts, layer.font);
  ctx.font = `${face.weight} ${size}px ${face.family}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lines = wrapLines((t) => ctx.measureText(t).width, layer.text, W * 0.88);
  const widths = lines.map((l) => ctx.measureText(l).width);
  const boxed = layer.style === "box" || layer.style === "volt";
  const padX = boxed ? size * 0.3 : 0;
  const lineHeight = size * (boxed ? 1.42 : 1.22);
  const widest = Math.max(...widths);
  const width = widest + 2 * padX;
  const height = lines.length * lineHeight;
  const cx = layer.x * W;
  const cy = layer.y * H;
  const box = { id: layer.id, x: cx - width / 2, y: cy - height / 2, width, height };
  const align = layer.align ?? "center";
  // The style's own outline and shadow, unless they were set.
  const outline = layer.outline ?? (layer.style === "bold" ? 0.17 : 0);
  const shadow = layer.shadow ?? !boxed;

  const settled = scene.paused && scene.selectedText === layer.id;
  const pose = settled ? { alpha: 1, scale: 1, dy: 0, chars: null } : textPose(layer, scene.time);
  if (pose.alpha <= 0) return box;
  ctx.save();
  ctx.translate(cx, cy + pose.dy * size);
  ctx.scale(pose.scale, pose.scale);
  ctx.globalAlpha = pose.alpha;
  ctx.lineJoin = "round";
  let left = pose.chars ?? Number.POSITIVE_INFINITY;
  lines.forEach((full, i) => {
    // Typing on: the letters so far, starting where the whole line will start.
    const chars = [...full];
    const line = chars.slice(0, Math.max(0, left)).join("");
    left -= chars.length + 1;
    if (!line) return;
    const x = align === "left" ? -widest / 2 : align === "right" ? widest / 2 - widths[i]! : -widths[i]! / 2;
    const y = (i - (lines.length - 1) / 2) * lineHeight;
    if (boxed) {
      const fill = layer.style === "volt" ? layer.color : isDark(layer.color) ? "#FFFFFF" : INK;
      ctx.fillStyle = fill;
      roundRect(ctx, x - padX, y - lineHeight / 2 + size * 0.04, ctx.measureText(line).width + 2 * padX, lineHeight - size * 0.08, size * 0.2);
      ctx.fillStyle = layer.style === "volt" ? (isDark(layer.color) ? "#FFFFFF" : INK) : layer.color;
      ctx.fillText(line, x, y + size * 0.03);
      return;
    }
    if (outline > 0) {
      ctx.strokeStyle = layer.outlineColor ?? (isDark(layer.color) ? "#FFFFFF" : "#000000");
      ctx.lineWidth = size * outline;
      if (shadow) {
        ctx.shadowColor = "rgb(0 0 0 / 0.45)";
        ctx.shadowOffsetY = size * 0.05;
      }
      ctx.strokeText(line, x, y);
      ctx.shadowColor = "transparent";
      ctx.shadowOffsetY = 0;
    } else if (shadow) {
      ctx.shadowColor = "rgb(0 0 0 / 0.6)";
      ctx.shadowBlur = size * 0.16;
      ctx.shadowOffsetY = size * 0.04;
    }
    ctx.fillStyle = layer.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = "transparent";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
  });
  ctx.restore();
  return box;
}

/** Each caption style's letters, as a share of the frame's width (Bamio's clip captions' sizes, ass.ts). */
const CAPTION_SIZE: Record<CaptionStyleId, number> = { pop: 0.066, karaoke: 0.055, clean: 0.047, boxed: 0.045 };

/** The caption being said now: its words in lines, the one being said lit (Pop shows the words up to it). */
function drawCaption(ctx: Ctx, W: number, H: number, scene: Scene) {
  const captions = scene.edit.captions;
  const shown = captions ? captionAt(scene.edit, scene.time) : null;
  if (!captions || !shown) return;
  const style = captions.style;
  const size = Math.max(8, CAPTION_SIZE[style] * captions.size * W);
  const face = faceOf(scene.fonts, captions.font);
  const font = (k: number) => `${face.weight} ${size * k}px ${face.family}`;
  ctx.save();
  ctx.font = font(1);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  // Words into lines no wider than the frame's middle, each word placed: the layout stays put as words light up.
  const max = W * 0.84;
  type Placed = { text: string; x: number; width: number; index: number };
  const lines: { words: Placed[]; width: number }[] = [];
  let line: Placed[] = [];
  let at = 0;
  shown.words.forEach((word, index) => {
    const gap = line.length > 0 ? ctx.measureText(wordGap(line.at(-1)!.text, word.text) || "").width : 0;
    const width = ctx.measureText(word.text).width;
    if (line.length > 0 && at + gap + width > max) {
      lines.push({ words: line, width: at });
      line = [];
      at = 0;
    }
    const x = line.length > 0 ? at + gap : 0;
    line.push({ text: word.text, x, width, index });
    at = x + width;
  });
  if (line.length > 0) lines.push({ words: line, width: at });
  const lineHeight = size * (style === "boxed" ? 1.45 : 1.18);
  const top = captions.y * H - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((row, r) => {
    const y = top + r * lineHeight;
    const x0 = W / 2 - row.width / 2;
    if (style === "boxed") {
      ctx.fillStyle = "rgb(0 0 0 / 0.72)";
      roundRect(ctx, x0 - size * 0.32, y - lineHeight / 2 + size * 0.06, row.width + size * 0.64, lineHeight - size * 0.12, size * 0.18);
    }
    for (const word of row.words) {
      const now = word.index === shown.active;
      // Pop: the words said so far; the next ones wait their turn (their place is kept).
      if (style === "pop" && word.index > shown.active) continue;
      const lit = (style === "pop" || style === "karaoke") && now;
      const grow = style === "pop" && now ? 1.1 : 1;
      ctx.font = font(grow);
      const x = x0 + word.x - (word.width * (grow - 1)) / 2;
      if (style === "pop" || style === "karaoke") {
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = size * (style === "pop" ? 0.16 : 0.12) * grow;
        ctx.strokeText(word.text, x, y);
      } else if (style === "clean") {
        ctx.shadowColor = "rgb(0 0 0 / 0.75)";
        ctx.shadowBlur = size * 0.18;
        ctx.shadowOffsetY = size * 0.04;
      }
      ctx.fillStyle = lit ? captions.highlight : captions.color;
      ctx.fillText(word.text, x, y);
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetY = 0;
    }
  });
  ctx.restore();
}

/** Draw the frame at `scene.time` on a canvas `W` by `H`. Returns where the text landed. */
export function drawScene(ctx: Ctx, W: number, H: number, scene: Scene): TextBox[] {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const { moment, picture } = scene;
  if (moment && picture && picture.width > 0 && picture.height > 0) {
    const { clip } = moment;
    const step = transitionAt(scene.edit, moment);
    if (step && scene.previous) drawTransition(ctx, W, H, scene, moment, picture, scene.previous, step);
    else drawClipFrame(ctx, W, H, scene, clip, picture, moment.local, moment.source);
    const level = fade(moment.local, clipLength(clip), clip.fadeIn, clip.fadeOut);
    if (level < 1) {
      ctx.fillStyle = `rgb(0 0 0 / ${(1 - level).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  for (const layer of scene.layers ?? []) if (layer.picture && layer.picture.width > 0) drawLayer(ctx, W, H, layer.overlay, layer.picture);

  drawCaption(ctx, W, H, scene);

  const boxes: TextBox[] = [];
  for (const layer of scene.edit.texts) {
    if (scene.time < layer.at || scene.time >= layer.at + layer.duration) continue;
    const box = drawText(ctx, W, H, layer, scene);
    if (box) boxes.push(box);
  }

  const { progress } = scene.edit;
  if (progress.on && scene.total > 0) {
    const h = Math.max(3, Math.round(H * 0.008));
    ctx.fillStyle = "rgb(0 0 0 / 0.35)";
    ctx.fillRect(0, progress.top ? 0 : H - h, W, h);
    ctx.fillStyle = progress.color;
    ctx.fillRect(0, progress.top ? 0 : H - h, W * Math.min(1, scene.time / scene.total), h);
  }
  ctx.restore();
  return boxes;
}

/** The text layer under a point of the canvas (the one drawn last, on top), if any. */
export function textBoxAt(boxes: TextBox[], x: number, y: number): TextBox | null {
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    const pad = 8;
    if (x >= b.x - pad && x <= b.x + b.width + pad && y >= b.y - pad && y <= b.y + b.height + pad) return b;
  }
  return null;
}
