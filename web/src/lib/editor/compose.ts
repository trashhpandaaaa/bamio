import { INK, lookFilter, type Clip, type Edit, type TextLayer } from "./model";
import { clipLength, fade, motionScale, textPose, type Moment } from "./timeline";

/*
 * Drawing one frame of an edit on a canvas: the main track's picture (cropped or fitted,
 * turned, flipped, coloured, faded), the text over it and the progress bar. The preview and
 * the export both draw with this, at their own sizes, so what's exported is what was seen:
 * every measure is a share of the frame, never a pixel count.
 */

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** A frame of video, or a photo, with its size as shown (after the file's own rotation). */
export type Picture = { image: CanvasImageSource; width: number; height: number };

export type Scene = {
  edit: Edit;
  time: number;
  total: number;
  /** What the main track shows now, and its picture (null while it's loading: the frame stays black). */
  moment: Moment | null;
  picture: Picture | null;
  /** The CSS font family for text. */
  font: string;
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

/** Behind a picture that doesn't fill the frame: a colour, or a soft dark copy of the picture itself. */
function drawBackdrop(ctx: Ctx, W: number, H: number, picture: Picture, clip: Clip, sw: number, sh: number, scene: Scene) {
  if (scene.edit.background !== "blur") {
    ctx.fillStyle = scene.edit.background;
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
  ctx.beginPath();
  if ("roundRect" in ctx) ctx.roundRect(x, y, w, h, r);
  else (ctx as Ctx).rect(x, y, w, h);
  ctx.fill();
}

function drawText(ctx: Ctx, W: number, H: number, layer: TextLayer, scene: Scene): TextBox | null {
  if (!layer.text.trim()) return null;
  const px = Math.max(6, layer.size * W);
  ctx.font = `800 ${px}px ${scene.font}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const lines = wrapLines((t) => ctx.measureText(t).width, layer.text, W * 0.88);
  const widths = lines.map((l) => ctx.measureText(l).width);
  const boxed = layer.style === "box" || layer.style === "volt";
  const padX = boxed ? px * 0.3 : 0;
  const lineHeight = px * (boxed ? 1.42 : 1.22);
  const width = Math.max(...widths) + 2 * padX;
  const height = lines.length * lineHeight;
  const cx = layer.x * W;
  const cy = layer.y * H;
  const box = { id: layer.id, x: cx - width / 2, y: cy - height / 2, width, height };

  const settled = scene.paused && scene.selectedText === layer.id;
  const pose = settled ? { alpha: 1, scale: 1, dy: 0, chars: null } : textPose(layer, scene.time);
  if (pose.alpha <= 0) return box;
  ctx.save();
  ctx.translate(cx, cy + pose.dy * px);
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
    const x = -widths[i]! / 2;
    const y = (i - (lines.length - 1) / 2) * lineHeight;
    if (boxed) {
      const fill = layer.style === "volt" ? layer.color : isDark(layer.color) ? "#FFFFFF" : INK;
      ctx.fillStyle = fill;
      roundRect(ctx, x - padX, y - lineHeight / 2 + px * 0.04, ctx.measureText(line).width + 2 * padX, lineHeight - px * 0.08, px * 0.2);
      ctx.fillStyle = layer.style === "volt" ? (isDark(layer.color) ? "#FFFFFF" : INK) : layer.color;
      ctx.fillText(line, x, y + px * 0.03);
      return;
    }
    if (layer.style === "bold") {
      ctx.strokeStyle = isDark(layer.color) ? "#FFFFFF" : "#000000";
      ctx.lineWidth = px * 0.17;
      ctx.shadowColor = "rgb(0 0 0 / 0.45)";
      ctx.shadowOffsetY = px * 0.05;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = "transparent";
    } else {
      ctx.shadowColor = "rgb(0 0 0 / 0.6)";
      ctx.shadowBlur = px * 0.16;
      ctx.shadowOffsetY = px * 0.04;
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

/** Draw the frame at `scene.time` on a canvas `W` by `H`. Returns where the text landed. */
export function drawScene(ctx: Ctx, W: number, H: number, scene: Scene): TextBox[] {
  ctx.save();
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  const { moment, picture } = scene;
  if (moment && picture && picture.width > 0 && picture.height > 0) {
    const { clip } = moment;
    const quarter = clip.rotate === 90 || clip.rotate === 270;
    const sw = quarter ? picture.height : picture.width;
    const sh = quarter ? picture.width : picture.height;
    if (clip.fit === "fit") drawBackdrop(ctx, W, H, picture, clip, sw, sh, scene);
    const base = clip.fit === "fit" ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
    const scale = base * clip.zoom * motionScale(clip, moment.local);
    const width = sw * scale;
    const height = sh * scale;
    // -1 shows the picture's left (or top) edge, 1 its right (or bottom), when there's more of it than fits.
    const cx = W / 2 - (clip.x * Math.max(0, width - W)) / 2;
    const cy = H / 2 - (clip.y * Math.max(0, height - H)) / 2;
    const filter = scene.filters ? lookFilter(clip) : "";
    if (filter) ctx.filter = filter;
    drawPicture(ctx, picture, clip, cx, cy, width, height);
    if (filter) ctx.filter = "none";
    const level = fade(moment.local, clipLength(clip), clip.fadeIn, clip.fadeOut);
    if (level < 1) {
      ctx.fillStyle = `rgb(0 0 0 / ${(1 - level).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

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
