"use client";

import { useEffect, useId, useRef } from "react";

/** Accessible confirmation built on <dialog> (focus trap, Esc to close, inert background). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

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
      aria-describedby={bodyId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <h2 className="dialog-title" id={titleId}>
        {title}
      </h2>
      <p className="dialog-body" id={bodyId}>
        {body}
      </p>
      <div className="dialog-actions">
        <button className="btn btn-ghost" type="button" onClick={onClose} autoFocus>
          {cancelLabel}
        </button>
        <button
          className={`btn ${destructive ? "btn-danger" : "btn-primary"}`}
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
