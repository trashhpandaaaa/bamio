"use client";

import { useEffect, useState } from "react";
import { aiClient } from "@/lib/ai/client";
import type { AiStatus } from "@/lib/ai/contracts";

let cached: Promise<AiStatus> | null = null;

/** Whether Gemini is configured on the server. Fetched once per page load. */
export function useAiStatus(): { status: AiStatus | null; error: boolean } {
  const [state, setState] = useState<{ status: AiStatus | null; error: boolean }>({ status: null, error: false });
  useEffect(() => {
    let alive = true;
    cached ??= aiClient.status().catch((err: unknown) => {
      cached = null;
      throw err;
    });
    cached.then(
      (status) => alive && setState({ status, error: false }),
      () => alive && setState({ status: null, error: true }),
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
