"use client";

import { PlayCircle } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { AD_REWARD_LINK, earnedMinutes, type AdCreditState } from "@/lib/ads";
import { api } from "@/lib/clips/api";
import styles from "./billing.module.css";

/** Earned time for people: seconds until there's a minute to show. */
const timeText = (sec: number) => (sec < 60 ? `${Math.floor(sec)} sec` : `${earnedMinutes(sec)} min`);

/**
 * Resolves after `ms`, counting down for the page. The ad is in another tab, so this is wall
 * clock, not time spent looking at Bamio. Each tick works the time out from a deadline rather
 * than subtracting, because a browser slows timers right down in a tab nobody is looking at.
 * The server checks its own clock before it credits anything; this only drives the countdown.
 */
function countdown(ms: number, onLeft: (left: number) => void): Promise<void> {
  return new Promise((resolve) => {
    const until = Date.now() + ms;
    onLeft(ms);
    const timer = setInterval(() => {
      const left = Math.max(0, until - Date.now());
      onLeft(left);
      if (left > 0) return;
      clearInterval(timer);
      resolve();
    }, 250);
  });
}

/**
 * Show an ad, from the click that asked for one. A zone with a rewarded format of its own puts
 * a `show_<zone>` function on window and that is used when it's there; otherwise the network's
 * direct link (AD_REWARD_LINK) opens in a new tab.
 *
 * Called straight from the click with nothing awaited first, so the browser still counts it as
 * the person's own gesture and no pop-up has to be slipped past a blocker. `opener` is dropped
 * at once: the destination is the network's to choose, and it is never given a handle on a page
 * where someone is signed in. Null means the browser blocked it, which the panel says out loud.
 */
function showAd(): Window | "vendor" | null {
  const name = Object.keys(window).find((key) => /^show_\d+$/.test(key));
  const fn = name ? (window as unknown as Record<string, unknown>)[name] : undefined;
  if (typeof fn === "function") {
    try {
      const shown = (fn as () => unknown)();
      if (shown instanceof Promise) void shown.catch(() => undefined);
      return "vendor";
    } catch {
      // The network's own function failed: fall back to the link below.
    }
  }
  const tab = window.open(AD_REWARD_LINK, "_blank");
  if (!tab) return null;
  try {
    tab.opener = null;
  } catch {
    // Some browsers won't let it be set; the link is still in its own tab.
  }
  return tab;
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
    setProblem(null);
    // The ad opens first, before anything is awaited, so the browser still sees the person's own
    // click behind it. The network is paid once its page opens, so an ad that opens and then
    // can't be counted costs the claim, not the advertiser: asking the server comes next.
    if (!showAd()) {
      setProblem("Your browser blocked the ad. Allow pop-ups for this site, then try again.");
      return;
    }
    busy.current = true;
    try {
      const view = await api.adCredits.start();
      await countdown(view.watchMs, setLeftMs);
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
        {watching ? `The ad is open in another tab. ${Math.ceil(leftMs / 1000)} seconds to go.` : `${timeText(state.earnedTodaySec)} earned today, of ${capMin} minutes a day.`}
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
      <p className={styles.small}>
        The ad opens in a new tab, on a page the advertiser controls, not Bamio. Leave it open for the few seconds above, then come back here and the time is added.
      </p>
    </section>
  );
}
