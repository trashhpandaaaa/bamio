"use client";

import { useCallback, useEffect, useState } from "react";
import type { BillingState } from "@/lib/billing/plans";
import { api, ApiError } from "@/lib/clips/api";

/**
 * The signed-in user's plan and AI minutes. `fresh`: read the plan from Stripe first (the
 * billing page, which people reach back from Checkout and the billing portal).
 */
export function useBilling(opts: { enabled?: boolean; fresh?: boolean } = {}) {
  const { enabled = true, fresh = false } = opts;
  const [billing, setBilling] = useState<BillingState | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    api
      .billing({ fresh, signal: controller.signal })
      .then((state) => {
        setBilling(state);
        setError(null);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiError ? err : new ApiError(0, "error", "Couldn’t load your plan. Try again."));
      });
    return () => controller.abort();
  }, [enabled, fresh, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { billing, error, refresh };
}
