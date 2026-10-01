"use client";

import { ArrowRight, LinkSimple, WarningCircle } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { parseVideoUrl } from "@/lib/clips/url";
import styles from "./link-form.module.css";

/**
 * "Paste a link, get clips": the landing page's one action, in the hero, the bar that follows
 * the page and the closing panel. A valid link opens the import page with it filled in
 * (sign-in comes first when needed, and returns there). Links without https:// are accepted.
 */
export function LinkForm({ variant, id }: { variant: "hero" | "bar" | "panel"; id?: string }) {
  const router = useRouter();
  const inputId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [going, setGoing] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const raw = text.trim();
    if (!raw) {
      setError("Paste a link to a video first.");
      input.current?.focus();
      return;
    }
    // "youtube.com/watch?v=..." without https:// is fine; anything else is checked as typed.
    const bare = !/^[a-z][a-z\d+.-]*:\/\//i.test(raw) && /^[^\s/]+\.[^\s/.]+(\/\S*)?$/.test(raw);
    const check = parseVideoUrl(bare ? `https://${raw}` : raw);
    if (!check.ok) {
      setError(check.message);
      input.current?.focus();
      return;
    }
    setGoing(true);
    router.push(`/new?url=${encodeURIComponent(check.url.toString())}`);
  }

  return (
    <form id={id} className={styles.form} data-variant={variant} onSubmit={submit} noValidate aria-label="Get clips from a video link">
      <div className={styles.field} data-invalid={error ? "" : undefined}>
        <LinkSimple className={styles.icon} size={20} aria-hidden />
        <label htmlFor={inputId} className="sr-only">
          Video link
        </label>
        <input
          ref={input}
          id={inputId}
          className={styles.input}
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="go"
          placeholder="Paste a video link"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
        <button className={`btn ${variant === "panel" ? "btn-primary" : "btn-volt"} ${styles.submit}`} type="submit" aria-busy={going || undefined}>
          Get clips
          <ArrowRight size={18} weight="bold" aria-hidden />
        </button>
      </div>
      {error ? (
        <p id={errorId} className={`field-error ${styles.error}`} role="alert">
          <WarningCircle size={14} weight="fill" aria-hidden /> {error}
        </p>
      ) : null}
    </form>
  );
}
