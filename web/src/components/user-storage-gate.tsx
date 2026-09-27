"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { useToast } from "@/components/toast";
import { adoptLegacyProjects, setStorageUser } from "@/lib/storage/db";

/**
 * Renders its children only after local storage points at the signed-in user's
 * database. Child effects run before parent effects, so the scope must be set
 * before any page reads projects.
 */
export function UserStorageGate({ children }: { children: React.ReactNode }) {
  const { isLoaded, userId } = useAuth();
  const [readyFor, setReadyFor] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setStorageUser(userId);
    adoptLegacyProjects()
      .then((moved) => {
        if (moved > 0) {
          toast({
            tone: "info",
            title: `${moved} ${moved === 1 ? "video" : "videos"} added to your account`,
            body: "Videos made on this device before you signed in are now saved under this account.",
          });
        }
      })
      .catch((err: unknown) => console.warn("[bamio] Could not move videos made before sign-in.", err))
      .finally(() => {
        if (alive) setReadyFor(userId);
      });
    return () => {
      alive = false;
    };
  }, [userId, toast]);

  if (!isLoaded || !userId || readyFor !== userId) {
    return (
      <div className="container" style={{ paddingTop: 40, display: "grid", gap: 16 }} aria-busy="true" aria-label="Loading your account">
        <div className="skeleton" style={{ height: 40, width: 280 }} />
        <div className="skeleton" style={{ height: 240 }} />
      </div>
    );
  }
  return <>{children}</>;
}
