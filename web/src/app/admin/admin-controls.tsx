"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useToast } from "@/components/toast";
import { PLAN_IDS, PLANS, type PlanId } from "@/lib/billing/plans";
import { api } from "@/lib/clips/api";
import styles from "./admin.module.css";

/** Runs a change, says how it went, and reloads the page's data. */
function useAction() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function run(work: () => Promise<unknown>, done: string) {
    setBusy(true);
    try {
      await work();
      toast({ tone: "success", title: done });
      router.refresh();
    } catch (err) {
      toast({ tone: "error", title: "That didn’t work", body: err instanceof Error ? err.message : "Try again." });
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

/** A free plan for this user, or none (superadmins). */
export function PlanGrantControl({ userId, granted }: { userId: string; granted: PlanId | null }) {
  const { busy, run } = useAction();
  const [plan, setPlan] = useState<PlanId | "">(granted ?? "");
  const id = useId();
  const save = () =>
    run(() => api.admin.grantPlan(userId, plan || null), plan ? `Free ${PLANS[plan].name} given` : "Free plan taken back");
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        Free plan
      </label>
      <div className={styles.inline}>
        <div className="select-wrap">
          <select id={id} className="select" value={plan} disabled={busy} onChange={(e) => setPlan(e.target.value as PlanId | "")}>
            <option value="">None</option>
            {PLAN_IDS.map((p) => (
              <option key={p} value={p}>
                {PLANS[p].name}
              </option>
            ))}
          </select>
          <CaretDown size={16} aria-hidden />
        </div>
        <button className="btn btn-secondary" type="button" disabled={busy || plan === (granted ?? "")} onClick={save}>
          Save
        </button>
      </div>
      <p className="field-help">A free plan works like a paid one, with no payment, until it’s taken back. A paid plan, if better, still wins.</p>
    </div>
  );
}

/** Retry a failed job, or stop a queued or running one. */
export function JobActions({ jobId, kind, canRetry, canCancel }: { jobId: number; kind: string; canRetry: boolean; canCancel: boolean }) {
  const { busy, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  const follow = kind === "follow";
  if (!canRetry && !canCancel) return null;
  return (
    <div className={styles.rowActions}>
      {canRetry ? (
        <button className="btn btn-secondary btn-sm" type="button" disabled={busy} onClick={() => run(() => api.admin.job(jobId, "retry"), `Job ${jobId} queued again`)}>
          Retry
        </button>
      ) : null}
      {canCancel ? (
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setConfirming(true)}>
          {follow ? "Stop" : "Cancel"}
        </button>
      ) : null}
      <ConfirmDialog
        open={confirming}
        title={follow ? `Stop following this stream?` : `Cancel job ${jobId}?`}
        body={
          follow
            ? "Recording ends now. What was recorded is kept and finished, like when its owner stops it."
            : "The work stops and its owner sees it failed, with a way to try again."
        }
        confirmLabel={follow ? "Stop" : "Cancel job"}
        cancelLabel="Keep it"
        destructive
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void run(() => api.admin.job(jobId, "cancel"), follow ? "Stream stopping" : `Job ${jobId} cancelled`);
        }}
      />
    </div>
  );
}

/** Make someone an admin by their account's email (superadmins). */
export function AddAdminForm() {
  const { busy, run } = useAction();
  const [email, setEmail] = useState("");
  const id = useId();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    void run(async () => {
      await api.admin.addAdmin(email.trim());
      setEmail("");
    }, `${email.trim()} is an admin now`);
  }
  return (
    <form className="field" onSubmit={submit}>
      <label className="field-label" htmlFor={id}>
        Add an admin
      </label>
      <div className={styles.inline}>
        <input id={id} className="input" type="email" placeholder="Their Bamio account’s email" autoComplete="off" value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
          Add admin
        </button>
      </div>
      <p className="field-help">They need a Bamio account. Admins see everything here and can retry or cancel jobs; they can’t give plans or change admins.</p>
    </form>
  );
}

export function RemoveAdminButton({ userId, email }: { userId: string; email: string }) {
  const { busy, run } = useAction();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => setConfirming(true)}>
        Remove
      </button>
      <ConfirmDialog
        open={confirming}
        title={`Remove ${email} as an admin?`}
        body="They lose the admin panel within a minute. Their own account and projects stay as they are."
        confirmLabel="Remove"
        destructive
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void run(() => api.admin.removeAdmin(userId), `${email} isn’t an admin any more`);
        }}
      />
    </>
  );
}

/** Approve someone's card for the Clippers page, or hide it. */
export function ClipperActions({ userId, name, status }: { userId: string; name: string; status: "pending" | "approved" | "hidden" }) {
  const { busy, run } = useAction();
  return (
    <div className={styles.rowActions}>
      {status !== "approved" ? (
        <button className="btn btn-primary btn-sm" type="button" disabled={busy} onClick={() => run(() => api.admin.clipper(userId, "approve"), `${name} is on the Clippers page`)}>
          Approve
        </button>
      ) : null}
      {status !== "hidden" ? (
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => run(() => api.admin.clipper(userId, "hide"), `${name} is hidden`)}>
          Hide
        </button>
      ) : null}
    </div>
  );
}
