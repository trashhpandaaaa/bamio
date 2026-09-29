"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useId } from "react";
import { AUTO_LANGUAGE, isAutoLanguage, LANGUAGE_OPTIONS, languageName } from "@/lib/clips/languages";

/** The spoken-language picker: detect automatically, or a language by name. */
export function LanguageSelect({ value, onChange, disabled }: { value: string; onChange: (code: string) => void; disabled?: boolean }) {
  const id = useId();
  const current = isAutoLanguage(value) ? AUTO_LANGUAGE : value;
  const listed = current === AUTO_LANGUAGE || LANGUAGE_OPTIONS.some((l) => l.code === current);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Spoken language
      </label>
      <div className="select-wrap">
        <select id={id} className="select" value={current} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value={AUTO_LANGUAGE}>Detect automatically</option>
          {listed ? null : <option value={current}>{languageName(current)}</option>}
          {LANGUAGE_OPTIONS.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
        <CaretDown size={16} aria-hidden />
      </div>
      <p className="field-help">Transcribed on this device with a time for every word, in any language. Pick the language if detection gets it wrong.</p>
    </div>
  );
}
