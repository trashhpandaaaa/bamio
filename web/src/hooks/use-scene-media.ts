"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch } from "react";
import { useToast } from "@/components/toast";
import { aiClient, base64ToBlob, errorMessage, isAbort } from "@/lib/ai/client";
import type { ProjectAction } from "@/lib/project/ops";
import type { Project, Scene } from "@/lib/project/schema";
import { audioKeyFor, isAudioCurrent } from "@/lib/project/timeline";
import { deleteAsset, putAsset } from "@/lib/storage/db";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];

export function sceneNeedsVoice(scene: Scene, project: Project): boolean {
  return project.brief.voiceover && scene.voiceover.trim().length > 0 && !isAudioCurrent(scene, project.style.voice);
}

export function sceneCanHavePicture(scene: Scene): boolean {
  return scene.shot !== "text-card";
}

/** Generate, upload and remove scene media. Tracks which jobs are running per scene. */
export function useSceneMedia(project: Project | null, dispatch: Dispatch<ProjectAction>) {
  const toast = useToast();
  const [busy, setBusy] = useState<Set<string>>(() => new Set());
  const controllers = useRef(new Set<AbortController>());
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  });

  useEffect(() => {
    const all = controllers.current;
    return () => all.forEach((c) => c.abort());
  }, []);

  const track = useCallback(async <T,>(key: string, job: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy((b) => new Set(b).add(key));
    try {
      return await job(controller.signal);
    } finally {
      controllers.current.delete(controller);
      setBusy((b) => {
        const next = new Set(b);
        next.delete(key);
        return next;
      });
    }
  }, []);

  const generatePicture = useCallback(
    async (scene: Scene): Promise<boolean> => {
      const p = projectRef.current;
      if (!p) return false;
      const visual = (scene.visual.trim() || scene.caption.trim() || p.brief.idea).slice(0, 500);
      const ok = await track(`img:${scene.id}`, async (signal) => {
        try {
          const res = await aiClient.image({ visual: visual.length >= 3 ? visual : `${visual} scene`, shot: scene.shot, tone: p.brief.tone }, signal);
          const assetId = await putAsset({ projectId: p.id, kind: "image", mime: res.mimeType, blob: base64ToBlob(res.data, res.mimeType) });
          dispatch({ type: "updateScene", id: scene.id, patch: { imageId: assetId } });
          if (scene.imageId) void deleteAsset(scene.imageId).catch(() => undefined);
          return true;
        } catch (err) {
          if (!isAbort(err)) toast({ tone: "error", title: "Couldn’t make the picture", body: errorMessage(err) });
          return false;
        }
      });
      return ok ?? false;
    },
    [dispatch, toast, track],
  );

  const uploadPicture = useCallback(
    async (scene: Scene, file: File) => {
      const p = projectRef.current;
      if (!p) return;
      if (!IMAGE_TYPES.includes(file.type)) {
        return toast({ tone: "error", title: "That file isn’t a picture", body: "Upload a JPG, PNG, WebP, GIF or AVIF image." });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return toast({ tone: "error", title: "That picture is too large", body: "Upload an image under 15 MB." });
      }
      await track(`img:${scene.id}`, async () => {
        try {
          // Validate that the browser can actually decode it before saving.
          const bitmap = await createImageBitmap(file);
          bitmap.close();
          const assetId = await putAsset({ projectId: p.id, kind: "image", mime: file.type, blob: file });
          const patch: Partial<Scene> = { imageId: assetId };
          if (scene.shot === "text-card") patch.shot = "medium";
          dispatch({ type: "updateScene", id: scene.id, patch });
          if (scene.imageId) void deleteAsset(scene.imageId).catch(() => undefined);
        } catch {
          toast({ tone: "error", title: "Couldn’t read that picture", body: "The file may be damaged. Try another image." });
        }
      });
    },
    [dispatch, toast, track],
  );

  const removePicture = useCallback(
    (scene: Scene) => {
      if (!scene.imageId) return;
      dispatch({ type: "updateScene", id: scene.id, patch: { imageId: undefined } });
      void deleteAsset(scene.imageId).catch(() => undefined);
    },
    [dispatch],
  );

  const generateVoice = useCallback(
    async (scene: Scene): Promise<boolean> => {
      const p = projectRef.current;
      const text = scene.voiceover.trim();
      if (!p || !text) return false;
      const voice = p.style.voice;
      const ok = await track(`voice:${scene.id}`, async (signal) => {
        try {
          const res = await aiClient.voice({ text, voice, tone: p.brief.tone }, signal);
          const assetId = await putAsset({ projectId: p.id, kind: "audio", mime: res.mimeType, blob: base64ToBlob(res.data, res.mimeType) });
          dispatch({
            type: "updateScene",
            id: scene.id,
            patch: { audioId: assetId, audioDurationSec: Math.round(res.durationSec * 100) / 100, audioKey: audioKeyFor(text, voice) },
          });
          if (scene.audioId) void deleteAsset(scene.audioId).catch(() => undefined);
          return true;
        } catch (err) {
          if (!isAbort(err)) toast({ tone: "error", title: "Couldn’t record the voice-over", body: errorMessage(err) });
          return false;
        }
      });
      return ok ?? false;
    },
    [dispatch, toast, track],
  );

  /** Run jobs two at a time; stop early if one fails (usually a key or quota problem). */
  const runAll = useCallback(async (scenes: Scene[], job: (s: Scene) => Promise<boolean>, what: string) => {
    let done = 0;
    let failed = false;
    const queue = [...scenes];
    const worker = async () => {
      while (queue.length && !failed) {
        const scene = queue.shift()!;
        if (await job(scene)) done++;
        else failed = true;
      }
    };
    await Promise.all([worker(), worker()]);
    if (done > 0 && !failed) toast({ tone: "success", title: `${what} ready`, body: `${done} ${done === 1 ? "scene" : "scenes"} updated.` });
  }, [toast]);

  const generateAllPictures = useCallback(async () => {
    const p = projectRef.current;
    if (!p) return;
    await runAll(p.scenes.filter((s) => sceneCanHavePicture(s) && !s.imageId), generatePicture, "Pictures");
  }, [generatePicture, runAll]);

  const generateAllVoice = useCallback(async () => {
    const p = projectRef.current;
    if (!p) return;
    await runAll(p.scenes.filter((s) => sceneNeedsVoice(s, p)), generateVoice, "Voice-over");
  }, [generateVoice, runAll]);

  return {
    busy,
    isBusy: (key: string) => busy.has(key),
    generatePicture,
    uploadPicture,
    removePicture,
    generateVoice,
    generateAllPictures,
    generateAllVoice,
  };
}
