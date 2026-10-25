"use client";

import { PlayCircle } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { earnedMinutes, type AdCreditState } from "@/lib/ads";
import { api } from "@/lib/clips/api";
import styles from "./billing.module.css";

/** Earned time for people: seconds until there's a minute to show. */
const timeText = (sec: number) => (sec < 60 ? `${Math.floor(sec)} sec` : `${earnedMinutes(sec)} min`);

/**
 * Resolves after `ms` of the page being visible. A tab in the background is showing nobody an
 * ad, so its time doesn't count. The server checks its own clock too: this only keeps an honest
 * page honest.
 */
function visibleFor(ms: number, onLeft: (left: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const step = 250;
    let left = ms;
    onLeft(left);
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      left = Math.max(0, left - step);
      onLeft(left);
      if (left > 0) return;
      clearInterval(timer);
      resolve();
    }, step);
  });
}

/**
 * Ask the ad network for an ad. The tag in every page's head (src/lib/ads.ts) places its own
 * formats and has nothing to call for most of them; a zone set up as a rewarded format puts a
 * `show_<zone>` function on window, and this uses it when it's there. Either way the minutes
 * come from the server's own clock, never from what this returns.
 */
function showAd(): void {
  const name = Object.keys(window).find((key) => /^show_\d+$/.test(key));
  const fn = name ? (window as unknown as Record<string, unknown>)[name] : undefined;
  if (typeof fn !== "function") return;
  try {
    const shown = (fn as () => unknown)();
    if (shown instanceof Promise) void shown.catch(() => undefined);
  } catch {
    // The network's own function failing changes nothing: the view is counted here either way.
  }
}

/**
 * Earn AI minutes by watching an ad: open to any signed-in account, with no plan and no card
 * (the user's decision, 2026-10-25). The seconds land on a balance that AI work spends once the
 * plan's or the free video's own minutes are gone, and one account can earn only so much a day.
 */
export function EarnMinutesPanel({ credits, onEarned }: { credits: AdCreditState; onEarned: () => void }) {
  const toast = useToast();
  const [state, setState] = useState(credits);
  const [leftMs, setLeftMs] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const busy = useRef(false);

  const capped = state.earnedTodaySec + state.rewardSec > state.dailyCapSec;
  const watching = leftMs > 0;
  const pct = state.dailyCapSec > 0 ? Math.min(100, (state.earnedTodaySec / state.dailyCapSec) * 100) : 100;
  const capMin = earnedMinutes(state.dailyCapSec);

  async function watch() {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    try {
      const view = await api.adCredits.start();
      showAd();
      await visibleFor(view.watchMs, setLeftMs);
      const next = await api.adCredits.claim(view.id);
      setState(next);
      onEarned();
      toast({ tone: "success", title: `${timeText(view.rewardSec)} of AI time earned`, body: `You have ${timeText(next.leftSec)} to spend on clips.` });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn’t count that ad. Try again.");
    } finally {
      busy.current = false;
      setLeftMs(0);
    }
  }

  return (
    <section className={`${styles.panel} ${styles.earnPanel}`} aria-labelledby="earn-title">
      <p className={styles.kicker}>
        <PlayCircle size={14} aria-hidden className={styles.inlineIcon} /> Earn AI minutes
      </p>
      <h2 id="earn-title" className="t-heading-md">
        Watch an ad, get {timeText(state.rewardSec)} of AI time
      </h2>
      <p className="t-body-sm t-secondary">
        The ads pay for the processing, so watching one earns you some. No plan and no card needed: the time goes on your balance and clipping spends it once your own
        minutes are gone. Up to {capMin} minutes a day.
      </p>
      <p className={styles.big}>
        {timeText(state.leftSec)} <span>earned and ready</span>
      </p>
      <div
        className={`progress ${styles.meter}`}
        role="progressbar"
        aria-label="Earned today, against the daily limit"
        aria-valuemin={0}
        aria-valuemax={Math.round(state.dailyCapSec)}
        aria-valuenow={Math.round(state.earnedTodaySec)}
      >
        <span style={{ "--value": `${Math.max(pct, state.earnedTodaySec > 0 ? 2 : 0)}%` } as React.CSSProperties} />
      </div>
      <p className="t-body-sm t-secondary" aria-live="polite">
        {watching ? `Keep watching: ${Math.ceil(leftMs / 1000)} seconds to go.` : `${timeText(state.earnedTodaySec)} earned today, of ${capMin} minutes a day.`}
      </p>
      {problem ? (
        <p className="field-error" role="alert">
          {problem}
        </p>
      ) : null}
      {capped && !watching ? (
        <p className={styles.out}>You’ve earned today’s {capMin} minutes. More tomorrow.</p>
      ) : (
        <div className={styles.actions}>
          <button className="btn btn-volt" type="button" onClick={() => void watch()} disabled={watching} aria-busy={watching}>
            <PlayCircle size={18} aria-hidden /> {watching ? `${Math.ceil(leftMs / 1000)}s left` : "Watch an ad"}
          </button>
        </div>
      )}
      <p className={styles.small}>An ad can open over this page or in another tab. Keep this tab in front: the time only counts while you can see it.</p>
    </section>
  );
}
