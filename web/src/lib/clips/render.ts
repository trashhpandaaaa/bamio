import { cropRect, OUTPUT_SIZE } from "@/lib/clips/logic";
import type { ClipEdit } from "@/lib/clips/schema";

/* ffmpeg arguments for a clip export (pure, so the filter graph is unit-tested). */

export type RenderPlan = {
  input: string;
  output: string;
  start: number;
  duration: number;
  srcW: number;
  srcH: number;
  hasAudio: boolean;
  edit: Pick<ClipEdit, "aspect" | "framing" | "focusX">;
  /** Burn in subs.ass (with fonts from ./fonts); ffmpeg must run with the work dir as cwd. */
  subtitles: boolean;
};

export function renderFilter(plan: Pick<RenderPlan, "srcW" | "srcH" | "edit" | "subtitles">): string {
  const { width: W, height: H } = OUTPUT_SIZE[plan.edit.aspect];
  const chain: string[] = [];
  if (plan.edit.framing === "crop") {
    const r = cropRect(plan.srcW, plan.srcH, plan.edit.aspect, plan.edit.focusX);
    chain.push(`[0:v]crop=${r.w}:${r.h}:${r.x}:${r.y},scale=${W}:${H}:flags=lanczos,setsar=1[base]`);
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
  // Complex shaping: without it libass draws Indic scripts without their conjuncts.
  chain.push(plan.subtitles ? `[base]ass=subs.ass:fontsdir=fonts:shaping=complex,format=yuv420p[v]` : `[base]format=yuv420p[v]`);
  return chain.join(";");
}

export function renderArgs(plan: RenderPlan): string[] {
  const audio = plan.hasAudio ? ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "160k", "-ac", "2", "-ar", "48000"] : ["-an"];
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-ss",
    plan.start.toFixed(3),
    "-i",
    plan.input,
    "-t",
    plan.duration.toFixed(3),
    "-filter_complex",
    renderFilter(plan),
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-profile:v",
    "high",
    ...audio,
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    plan.output,
  ];
}
