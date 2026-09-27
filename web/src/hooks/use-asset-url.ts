"use client";

import { useEffect, useState } from "react";
import { getAsset } from "@/lib/storage/db";

/** Object URL for a stored asset. Revoked automatically when the id changes or on unmount. */
export function useAssetUrl(assetId: string | undefined): string | null {
  const [url, setUrl] = useState<{ id: string; url: string } | null>(null);

  useEffect(() => {
    if (!assetId) return;
    let objectUrl: string | null = null;
    let alive = true;
    getAsset(assetId)
      .then((asset) => {
        if (!alive || !asset) return;
        objectUrl = URL.createObjectURL(asset.blob);
        setUrl({ id: assetId, url: objectUrl });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);

  return assetId && url?.id === assetId ? url.url : null;
}
