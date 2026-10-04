/* How the admin panel writes times, lengths and sizes. Times are UTC, the same for every admin. */

export const when = (ms: number | null | undefined) => (ms ? `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC` : "—");

export function ago(ms: number | null | undefined, now = Date.now()) {
  if (!ms) return "—";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return when(ms).slice(0, 10);
}

/** "42 s", "12 min", "3 h 05 min". */
export function length(sec: number) {
  if (sec < 60) return `${Math.round(sec)} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h ${String(Math.round((sec % 3600) / 60)).padStart(2, "0")} min`;
}

export function bytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export const count = (n: number) => n.toLocaleString("en-US");

/** A job's or project's state, as a badge class. */
export const statusTone = (status: string) =>
  status === "done" || status === "ready" || status === "sent" || status === "active" || status === "credited"
    ? "is-success"
    : status === "failed" || status === "error"
      ? "is-error"
      : status === "running" || status === "queued" || status === "processing" || status === "pending" || status === "earned"
        ? "is-info"
        : "";
