import Link from "next/link";

/** Lowercase "bamio"; the dot of the i is a 9:16 frame tilted 12 degrees. */
export function Wordmark({ href = "/", size = 27 }: { href?: string; size?: number }) {
  return (
    <Link href={href} className="wordmark" style={{ fontSize: size }} aria-label="Bamio home">
      <span aria-hidden="true" translate="no">
        bam
        <span className="i">
          ı<span className="tittle" />
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
