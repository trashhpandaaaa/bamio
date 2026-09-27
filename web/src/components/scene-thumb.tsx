"use client";

import { useAssetUrl } from "@/hooks/use-asset-url";
import type { Scene } from "@/lib/project/schema";
import { cardColors } from "@/lib/render/renderer";
import styles from "./scene-thumb.module.css";

/** A scene's picture, or the text card the renderer will draw when there is none. */
export function SceneThumb({ scene, index, className, alt = "" }: { scene: Scene; index: number; className?: string; alt?: string }) {
  const url = useAssetUrl(scene.shot === "text-card" ? undefined : scene.imageId);
  const cls = `${styles.thumb} ${className ?? ""}`;
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- local object URL, nothing to optimise
    return <img className={cls} src={url} alt={alt} width={216} height={384} draggable={false} />;
  }
  const { bg, fg } = cardColors(index);
  return (
    <div className={`${cls} ${styles.card}`} style={{ background: bg, color: fg }} role={alt ? "img" : undefined} aria-label={alt || undefined}>
      <span>{scene.caption.trim() || " "}</span>
    </div>
  );
}
