/**
 * Structured data for search engines and AI assistants (schema.org JSON-LD), as Next.js
 * recommends: a script tag in the page, with "<" escaped so text in it can't close the tag.
 */
export function JsonLd({ data }: { data: Record<string, unknown>[] }) {
  const graph = { "@context": "https://schema.org", "@graph": data };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(graph).replace(/</g, "\\u003c") }} />;
}
