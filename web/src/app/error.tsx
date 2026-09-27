"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[bamio] Unhandled error", error);
  }, [error]);
  return (
    <main id="main" className="container state-panel" style={{ minHeight: "80dvh", alignContent: "center" }}>
      <h1 className="t-heading-xl">Something broke on this screen.</h1>
      <p>Your videos are saved in this browser, so nothing is lost. Try again, or go back to your videos.</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
        <button className="btn btn-primary" type="button" onClick={reset}>
          Try again
        </button>
        <Link href="/projects" className="btn btn-secondary">
          Your videos
        </Link>
      </div>
    </main>
  );
}
