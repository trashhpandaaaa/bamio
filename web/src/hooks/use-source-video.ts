"use client";

import { useEffect, type RefObject } from "react";
import { liveUrl, sourceUrl } from "@/lib/clips/api";

/**
 * Plays a project's video in `video`: source.mp4, or while a stream is followed its
 * growing HLS playlist (hls.js, loaded only then; Safari plays HLS itself). When
 * following ends and the MP4 takes over, playback carries on from the same moment.
 */
export function useSourceVideo(ref: RefObject<HTMLVideoElement | null>, projectId: string, following: boolean) {
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const resumeAt = video.currentTime;
    const resume = () => {
      if (resumeAt > 0 && Math.abs(video.currentTime - resumeAt) > 0.5) video.currentTime = resumeAt;
    };
    video.addEventListener("loadedmetadata", resume, { once: true });
    if (!following) {
      video.src = sourceUrl(projectId);
      return () => video.removeEventListener("loadedmetadata", resume);
    }
    const url = liveUrl(projectId);
    let cancelled = false;
    let destroy: (() => void) | undefined;
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = url;
        return;
      }
      // The playlist only grows (EVENT): start at the beginning, not the live edge.
      const hls = new Hls({ startPosition: resumeAt, maxBufferLength: 30, backBufferLength: 90 });
      hls.loadSource(url);
      hls.attachMedia(video);
      destroy = () => hls.destroy();
    });
    return () => {
      cancelled = true;
      video.removeEventListener("loadedmetadata", resume);
      destroy?.();
    };
  }, [ref, projectId, following]);
}
