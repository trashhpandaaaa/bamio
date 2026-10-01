import Link from "next/link";

/*
 * The scissors that dot the i in the wordmark: handles back, blades forward, tilted 12 degrees
 * up (the angle the old 9:16-frame dot had). Also the app icon (src/app/icon.svg, ink on volt).
 * Drawn in currentColor; generated from simple geometry (two rings, two tapered blades).
 */
export const SCISSORS_VIEWBOX = "0 0 31.97 25.09";
export const SCISSORS_PATH =
  "M0 8.33a5.8 5.8 0 1 0 11.6 0a5.8 5.8 0 1 0 -11.6 0ZM2.9 8.33a2.9 2.9 0 1 1 5.8 0a2.9 2.9 0 1 1 -5.8 0ZM2.33 19.29a5.8 5.8 0 1 0 11.6 0a5.8 5.8 0 1 0 -11.6 0ZM5.23 19.29a2.9 2.9 0 1 1 5.8 0a2.9 2.9 0 1 1 -5.8 0ZM9.22 11.74L16.35 14.18L31.51 18L31.97 16.67L18.12 9.07L10.6 7.77ZM12.74 17.84L19.08 13.6L28.64 1.02L27.68 0L15.39 9.66L9.87 14.78Z";

export function ScissorsMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox={SCISSORS_VIEWBOX} aria-hidden="true" focusable="false">
      <path fill="currentColor" d={SCISSORS_PATH} />
    </svg>
  );
}

/** Lowercase "bamio"; the dot of the i is a pair of scissors. */
export function Wordmark({ href = "/", size = 27 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="wordmark" style={{ fontSize: size }} aria-label="Bamio home">
      <span aria-hidden="true" translate="no">
        bam
        <span className="i">
          ı<ScissorsMark className="tittle" />
        </span>
        o
      </span>
    </Link>
  );
}

/** Labels work Bamio's AI did. Always pair it with a verb. */
export function AiMark({ size }: { size?: number }) {
  return <span className="ai-mark" style={size ? { fontSize: size } : undefined} aria-hidden="true" />;
}
