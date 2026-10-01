"use client";

import { CircleHalf, Moon, Sun } from "@phosphor-icons/react";
import { useSyncExternalStore } from "react";

type Theme = "system" | "paper" | "night";
const KEY = "bamio-theme";
const listeners = new Set<() => void>();

function read(): Theme {
  const t = document.documentElement.dataset.theme;
  return t === "paper" || t === "night" ? t : "system";
}

function write(theme: Theme) {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice lasts for this page only.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const OPTIONS = [
  { value: "system", label: "Match device", Icon: CircleHalf },
  { value: "paper", label: "Paper theme", Icon: Sun },
  { value: "night", label: "Night theme", Icon: Moon },
] as const;

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  return (
    <div className="seg" role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button key={value} type="button" aria-pressed={theme === value} aria-label={label} title={label} onClick={() => write(value)}>
          <Icon size={16} aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** One button that steps through the themes (match device, paper, night), for bars with little room. */
export function ThemeCycleButton({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  const at = OPTIONS.findIndex((o) => o.value === theme);
  const { label, Icon } = OPTIONS[at]!;
  const next = OPTIONS[(at + 1) % OPTIONS.length]!;
  return (
    <button
      className={`btn btn-ghost btn-icon btn-sm ${className}`}
      type="button"
      aria-label={`Theme: ${label}. Switch to ${next.label.toLowerCase()}`}
      title={`${label} (switch to ${next.label.toLowerCase()})`}
      onClick={() => write(next.value)}
    >
      <Icon size={18} aria-hidden />
    </button>
  );
}
