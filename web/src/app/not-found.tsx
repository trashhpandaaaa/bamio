import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function NotFound() {
  return (
    <main id="main" className="container state-panel" style={{ minHeight: "80dvh", alignContent: "center" }}>
      <Wordmark />
      <h1 className="t-display-lg">this page isn’t here.</h1>
      <p>The link may be old, or the page moved.</p>
      <Link href="/projects" className="btn btn-primary">
        Go to your videos
      </Link>
    </main>
  );
}
