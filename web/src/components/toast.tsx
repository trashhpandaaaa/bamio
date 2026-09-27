"use client";

import { CheckCircle, Info, WarningCircle, X } from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { newId } from "@/lib/ids";

type Tone = "success" | "error" | "info";
type ToastItem = { id: string; tone: Tone; title: string; body?: string };
type Push = (toast: Omit<ToastItem, "id">) => void;

const ToastContext = createContext<Push>(() => undefined);

const ICONS = { success: CheckCircle, error: WarningCircle, info: Info } as const;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<Push>(
    (toast) => {
      const id = newId();
      setToasts((all) => [...all.slice(-2), { ...toast, id }]);
      timers.current.set(id, setTimeout(() => dismiss(id), toast.tone === "error" ? 9000 : 5000));
    },
    [dismiss],
  );

  useEffect(() => {
    const map = timers.current;
    return () => map.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-region" aria-live="polite" aria-relevant="additions">
        {toasts.map((t) => {
          const Icon = ICONS[t.tone];
          return (
            <div key={t.id} className={`toast is-${t.tone}`} role={t.tone === "error" ? "alert" : "status"}>
              <Icon size={20} weight="fill" aria-hidden />
              <div>
                <p className="toast-title">{t.title}</p>
                {t.body ? <p className="toast-body">{t.body}</p> : null}
              </div>
              <button className="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
                <X size={16} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
