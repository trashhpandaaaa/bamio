import { keepExpr, mergeCuts, type Cut } from "@/lib/clips/cuts";
import { cropRect, outputSize } from "@/lib/clips/logic";
import type { ClipEdit, FocusPoint, LogoSpot } from "@/lib/clips/schema";

/* ffmpeg arguments for a clip export (pure, so the filter graph is unit-tested). */

/** The sendcmd file that moves the crop as the clip plays (face tracking), beside subs.ass. */
export const FOCUS_CMD_FILE = "focus.cmd";

/** How wide the brand logo is drawn, and how far from the edge, as shares of the frame. */
export const LOGO_WIDTH = 0.14;
export const LOGO_MARGIN = 0.045;

export type RenderPlan = {
  input: string;
  output: string;
  start: number;
  duration: number;
  srcW: number;
  srcH: number;
  hasAudio: boolean;
  edit: Pick<ClipEdit, "aspect" | "framing" | "focusX"> & Partial<Pick<ClipEdit, "quality" | "logo">>;
  /** Burn in subs.ass (with fonts from ./fonts); ffmpeg must run with the work dir as cwd. */
  subtitles: boolean;
  /**
   * Parts of the clip to drop, in its own seconds (filler-word removal): the frames inside
   * them are dropped and the gap closed. The captions were moved to match before the ASS was
   * built (lib/clips/cuts.ts), so this is the only place the video is re-timed.
   */
  cuts?: readonly Cut[];
  /** A logo file to burn into the corner that `edit.logo` names (a second input). */
  logo?: string;
  /** Face tracking wrote FOCUS_CMD_FILE into the work dir: the crop follows it. */
  focusCmd?: boolean;
};

/** Where an overlay of this size sits in the frame. */
function logoPlace(spot: LogoSpot, margin: number): string {
  const x = spot === "top-right" || spot === "bottom-right" ? `main_w-overlay_w-${margin}` : `${margin}`;
  const y = spot === "bottom-left" || spot === "bottom-right" ? `main_h-overlay_h-${margin}` : `${margin}`;
  return `${x}:${y}`;
}

export function renderFilter(plan: Pick<RenderPlan, "srcW" | "srcH" | "edit" | "subtitles"> & Partial<Pick<RenderPlan, "cuts" | "logo" | "focusCmd" | "hasAudio">>): string {
  const { width: W, height: H } = outputSize(plan.edit.aspect, plan.edit.quality ?? "1080p");
  const chain: string[] = [];
  if (plan.edit.framing === "crop") {
    const r = cropRect(plan.srcW, plan.srcH, plan.edit.aspect, plan.edit.focusX);
    // Every frame at the video's recorded size first: a live stream can change resolution part
    // way (Twitch dropped one from 1080p to 720p), and a crop sized for 1080p fails on 720p
    // frames. Frames already that size pass straight through.
    // With face tracking, sendcmd moves the crop's x as the clip plays; without it x never changes.
    const move = plan.focusCmd ? `sendcmd=filename=${FOCUS_CMD_FILE},` : "";
    chain.push(`[0:v]scale=${plan.srcW}:${plan.srcH},${move}crop=${r.w}:${r.h}:${r.x}:${r.y},scale=${W}:${H}:flags=lanczos,setsar=1[base]`);
  } else {
    // Fit: the whole frame, over a blurred, darkened copy that fills the rest.
    const bw = W / 4;
    const bh = H / 4;
    chain.push(
      `[0:v]split=2[bgsrc][fgsrc]`,
      `[bgsrc]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},boxblur=10:2,scale=${W}:${H},eq=brightness=-0.12[bg]`,
      `[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease:force_divisible_by=2[fg]`,
      `[bg][fg]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2,setsar=1[base]`,
    );
  }

  // Drop the cut parts and close the gap, before anything is drawn on top: the captions were
  // already moved to the times that come out of this.
  const cuts = mergeCuts(plan.cuts ?? []);
  let video = "base";
  if (cuts.length > 0) {
    chain.push(`[base]select=${keepExpr(cuts)},setpts=N/FRAME_RATE/TB[cut]`);
    video = "cut";
  }

  // The logo goes under the captions, so a caption is never hidden behind it.
  const spot = plan.edit.logo;
  if (plan.logo && spot && spot !== "off") {
    const margin = Math.round(Math.min(W, H) * LOGO_MARGIN);
    chain.push(`[1:v]scale=${Math.round(W * LOGO_WIDTH)}:-1[mark]`, `[${video}][mark]overlay=${logoPlace(spot, margin)}:format=auto[marked]`);
    video = "marked";
  }

  // Complex shaping: without it libass draws Indic scripts without their conjuncts.
  chain.push(plan.subtitles ? `[${video}]ass=subs.ass:fontsdir=fonts:shaping=complex,format=yuv420p[v]` : `[${video}]format=yuv420p[v]`);
  if (plan.hasAudio && cuts.length > 0) chain.push(`[0:a:0]aselect=${keepExpr(cuts)},asetpts=N/SR/TB[a]`);
  return chain.join(";");
}

/**
 * The sendcmd file that walks the crop along a face-tracking path. Each point sets the crop's
 * x for the moment it is reached; between points ffmpeg holds the last value, and the path is
 * already eased (lib/clips/focus.ts), so steps a quarter second apart aren't seen.
 */
export function focusCommands(path: readonly FocusPoint[], srcW: number, srcH: number, edit: Pick<ClipEdit, "aspect" | "focusX">): string {
  const widest = cropRect(srcW, srcH, edit.aspect, 0).w;
  const room = Math.max(0, srcW - widest);
  const lines = path
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.x))
    .sort((a, b) => a.t - b.t)
    .map((p) => {
      const x = Math.max(0, Math.min(room, Math.round((room * Math.min(1, Math.max(0, p.x))) / 2) * 2));
      return `${Math.max(0, p.t).toFixed(3)} crop x ${x};`;
    });
  return `${lines.join("\n")}\n`;
}

export function renderArgs(plan: RenderPlan): string[] {
  const cuts = mergeCuts(plan.cuts ?? []);
  // With cuts the sound is re-timed in the graph too, so it comes from the filter, not the input.
  const audio = plan.hasAudio
    ? [...(cuts.length > 0 ? ["-map", "[a]"] : ["-map", "0:a:0?"]), "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "48000"]
    : ["-an"];
  const uhd = (plan.edit.quality ?? "1080p") === "4k";
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-ss",
    plan.start.toFixed(3),
    "-i",
    plan.input,
    ...(plan.logo && plan.edit.logo && plan.edit.logo !== "off" ? ["-i", plan.logo] : []),
    "-t",
    plan.duration.toFixed(3),
    "-filter_complex",
    renderFilter(plan),
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-preset",
    // 4K at veryfast would outrun the disk and the Droplet's two cores; faster is the practical floor.
    uhd ? "faster" : "veryfast",
    "-crf",
    uhd ? "21" : "20",
    "-profile:v",
    "high",
    ...(uhd ? ["-level", "5.1"] : []),
    ...audio,
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    plan.output,
  ];
}
