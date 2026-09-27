import type { Project } from "@/lib/project/schema";
import { isAudioCurrent, type Timeline } from "@/lib/project/timeline";
import { getAsset } from "@/lib/storage/db";

/* Loads a project's pictures and voice-over into forms the renderer and Web Audio can use. */

export async function loadImages(project: Project): Promise<Map<string, ImageBitmap>> {
  const images = new Map<string, ImageBitmap>();
  await Promise.all(
    project.scenes.map(async (scene) => {
      if (!scene.imageId) return;
      const asset = await getAsset(scene.imageId);
      if (!asset) return;
      try {
        images.set(scene.id, await createImageBitmap(asset.blob));
      } catch (err) {
        console.warn("[bamio] Could not decode an image; the scene will render as a card.", err);
      }
    }),
  );
  return images;
}

export function closeImages(images: Map<string, ImageBitmap>) {
  for (const bitmap of images.values()) bitmap.close();
  images.clear();
}

/** Decode voice-over clips that are current for the scene text and voice. */
export async function loadVoice(ctx: BaseAudioContext, project: Project): Promise<Map<string, AudioBuffer>> {
  const buffers = new Map<string, AudioBuffer>();
  if (!project.brief.voiceover) return buffers;
  await Promise.all(
    project.scenes.map(async (scene) => {
      if (!scene.audioId || !isAudioCurrent(scene, project.style.voice)) return;
      const asset = await getAsset(scene.audioId);
      if (!asset) return;
      try {
        buffers.set(scene.id, await ctx.decodeAudioData(await asset.blob.arrayBuffer()));
      } catch (err) {
        console.warn("[bamio] Could not decode a voice-over clip; the scene will be silent.", err);
      }
    }),
  );
  return buffers;
}

/**
 * Schedule every voice-over clip that is still audible at `from` seconds into the
 * timeline, starting at audio-context time `when`. Returns the sources so they can be stopped.
 */
export function scheduleVoice(
  ctx: BaseAudioContext,
  destination: AudioNode,
  timeline: Timeline,
  buffers: Map<string, AudioBuffer>,
  from: number,
  when: number,
): AudioBufferSourceNode[] {
  const sources: AudioBufferSourceNode[] = [];
  for (const item of timeline.items) {
    const buffer = buffers.get(item.scene.id);
    if (!buffer) continue;
    const clipEnd = item.start + buffer.duration;
    if (clipEnd <= from) continue;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    const offset = Math.max(0, from - item.start);
    const delay = Math.max(0, item.start - from);
    source.start(when + delay, offset);
    sources.push(source);
  }
  return sources;
}

export function stopSources(sources: AudioBufferSourceNode[]) {
  for (const s of sources) {
    try {
      s.stop();
    } catch {
      // Already stopped.
    }
    s.disconnect();
  }
}
