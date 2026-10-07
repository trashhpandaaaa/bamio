"use client";

import { useEffect, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { api } from "@/lib/clips/api";

/**
 * The free first video's card check, for the pages that offer it (import, Plan & billing).
 * `start` sends the browser to Stripe's page, where the card is checked and saved, never
 * charged. Stripe returns to the same page with ?trial_card=<the check's id> (`returned`, read
 * by the page on the server): the card is then tied to the trial, once per card, and
 * `onAdded` runs. `problem` says why a card couldn't be used.
 */
export function useTrialCard(opts: { from: "new" | "billing"; returned?: string; link?: string; onAdded: () => void }) {
  const { from, returned, link, onAdded } = opts;
  const toast = useToast();
  const [state, setState] = useState<"idle" | "opening" | "checking">(returned ? "checking" : "idle");
  const [problem, setProblem] = useState<string | null>(null);
  const confirmed = useRef(false);

  useEffect(() => {
    if (!returned || confirmed.current) return;
    confirmed.current = true;
    // Out of the address, so a reload doesn't ask Stripe about it again.
    const url = new URL(window.location.href);
    url.searchParams.delete("trial_card");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    api.trialCard.confirm(returned).then(
      () => {
        setState("idle");
        toast({ tone: "success", title: "Card added", body: "Nothing was charged. Your free video is ready." });
        onAdded();
      },
      (err: unknown) => {
        setState("idle");
        setProblem(err instanceof Error ? err.message : "Couldn’t check your card. Try again.");
      },
    );
  }, [returned, toast, onAdded]);

  // Back from Stripe with the browser's back button: the page comes back as it was left.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setState("idle");
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  async function start() {
    setState("opening");
    setProblem(null);
    try {
      window.location.assign((await api.trialCard.start({ from, link })).url);
    } catch (err) {
      setState("idle");
      setProblem(err instanceof Error ? err.message : "Couldn’t open the card page. Try again.");
    }
  }

  return { busy: state !== "idle", checking: state === "checking", start, problem };
}
