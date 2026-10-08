"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LanguageSelect } from "@/components/language-select";

/**
 * Pick the spoken language and transcribe again, for a video whose language was detected
 * wrong (or picked wrong). Built on <dialog> like ConfirmDialog.
 */
export function LanguageDialog({ open, current, onConfirm, onClose }: { open: boolean; current: string; onConfirm: (language: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <h2 className="dialog-title" id={titleId}>
        Change the spoken language
      </h2>
      {/* Mounted while open, so it starts from the current language each time. */}
      {open ? <Choice current={current} onConfirm={onConfirm} onClose={onClose} /> : null}
    </dialog>
  );
}

function Choice({ current, onConfirm, onClose }: { current: string; onConfirm: (language: string) => void; onClose: () => void }) {
  const [language, setLanguage] = useState(current);
  return (
    <>
      <p className="dialog-body">Bamio transcribes the video again in the language you pick. Caption word fixes will be replaced, and AI clips move to where their words are.</p>
      <div className="dialog-body">
        <LanguageSelect value={language} onChange={setLanguage} />
      </div>
      <div className="dialog-actions">
        <button className="btn btn-ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            onConfirm(language);
            onClose();
          }}
        >
          Transcribe again
        </button>
      </div>
    </>
  );
}
