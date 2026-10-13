import { FORMATS, WHOLE, type Clip, type Edit, type Media, type Overlay, type Rect } from "./model";
import { addOverlay, layout, overlayLength } from "./timeline";

/*
 * Layouts: where the main picture sits on the frame, and what shares it. A facecam is a second
 * view of the same clip (its `cam`: the corner of the picture with the camera in it, shown on
 * top), so it stays in step through every cut. A split screen or a picture-in-picture is a
 * layer of another file (an overlay) over the clips' time.
 */

export const LAYOUTS = { full: "Full frame", facecam: "Facecam on top", split: "Split screen", pip: "Picture in picture" } as const;
export type LayoutId = keyof typeof LAYOUTS;

/** Where a stream's camera usually is: a corner of the picture. */
export const CAM_CORNERS = { tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right" } as const;
export type CamCorner = keyof typeof CAM_CORNERS;

/** The part of the picture a camera in that corner takes: about a quarter across and a third down. */
export function camCrop(corner: CamCorner): Rect {
  const w = 0.28;
  const h = 0.36;
  return { x: corner === "tl" || corner === "bl" ? 0 : 1 - w, y: corner === "tl" || corner === "tr" ? 0 : 1 - h, w, h };
}

/** The facecam's band at the top of the frame, and the picture's under it. */
const CAM_BAND = 0.36;

/**
 * A layout for some clips (the selected one, or every clip of its file). `other`: the file for a
 * split screen or a picture-in-picture, shown as a layer over those clips' time. Returns the
 * edit and the layer made, if any.
 */
export function applyLayout(edit: Edit, clipIds: readonly string[], kind: LayoutId, other?: Media): { edit: Edit; overlayId: string | null } {
  const chosen = new Set(clipIds);
  const reshape = (patch: (clip: Clip) => Clip): Edit => ({ ...edit, clips: edit.clips.map((c) => (chosen.has(c.id) ? patch(c) : c)), updatedAt: Date.now() });
  if (kind === "full") return { edit: reshape((clip) => ({ ...clip, box: undefined, cam: undefined })), overlayId: null };
  if (kind === "facecam") {
    return {
      edit: reshape((clip) => ({
        ...clip,
        fit: "fill",
        box: { x: 0, y: CAM_BAND, w: 1, h: 1 - CAM_BAND },
        cam: { crop: clip.cam?.crop ?? camCrop("tl"), box: { x: 0, y: 0, w: 1, h: CAM_BAND }, radius: 0 },
      })),
      overlayId: null,
    };
  }
  if (!other) return { edit, overlayId: null };
  // The other file over the chosen clips' stretch of the timeline.
  const placed = layout(edit).filter((p) => chosen.has(p.clip.id));
  if (placed.length === 0) return { edit, overlayId: null };
  const from = Math.min(...placed.map((p) => p.from));
  const to = Math.max(...placed.map((p) => p.to));
  const base = kind === "split" ? reshape((clip) => ({ ...clip, cam: undefined, fit: "fill", box: { x: 0, y: 0, w: 1, h: 0.5 } })) : edit;
  const added = addOverlay(base, other, from);
  if (!added.id) return { edit, overlayId: null };
  const frame = FORMATS[edit.format];
  const aspect = other.width > 0 && other.height > 0 ? other.width / other.height : 16 / 9;
  const pipW = 0.36;
  const box: Rect = kind === "split" ? { x: 0, y: 0.5, w: 1, h: 0.5 } : { x: 1 - pipW - 0.05, y: 0.06, w: pipW, h: Math.min(0.5, (pipW * frame.width) / aspect / frame.height) };
  const overlays = added.edit.overlays.map((o): Overlay => {
    if (o.id !== added.id) return o;
    const length = Math.min(to - from, other.kind === "image" ? to - from : other.duration);
    return { ...o, box, crop: WHOLE, radius: kind === "pip" ? 0.12 : 0, border: kind === "pip", end: o.start + length * o.speed };
  });
  return { edit: { ...added.edit, overlays }, overlayId: added.id };
}

/** Which layout clips have: the first clip's, when they all share it. */
export function layoutOf(edit: Edit, clip: Clip): LayoutId {
  if (clip.cam) return "facecam";
  if (clip.box && clip.box.h <= 0.5 + 1e-6) return "split";
  const placed = layout(edit).find((p) => p.clip.id === clip.id);
  const covered = placed && edit.overlays.some((o) => o.at < placed.to && o.at + overlayLength(o) > placed.from && o.border);
  return covered ? "pip" : "full";
}

/** The facecam of some clips taken from another corner of their picture (they get one if they had none). */
export function setCamCorner(edit: Edit, clipIds: readonly string[], corner: CamCorner): Edit {
  const ids = new Set(clipIds);
  const base = edit.clips.some((c) => ids.has(c.id) && !c.cam) ? applyLayout(edit, clipIds, "facecam").edit : edit;
  return { ...base, clips: base.clips.map((c) => (ids.has(c.id) && c.cam ? { ...c, cam: { ...c.cam, crop: camCrop(corner) } } : c)), updatedAt: Date.now() };
}
