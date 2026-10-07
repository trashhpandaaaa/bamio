import type { SiteLink } from "@/components/site/site-chrome";

/*
 * Who runs Bamio, for the Terms, the Privacy Policy and the Takedown page. Placeholders until
 * the real details are filled in: while `ready` is false the pages still render (to read the
 * drafts) but aren't linked from the footer, aren't in the sitemap and tell search engines not
 * to index them. Fill in every field, set `ready: true`, and have a lawyer read the pages.
 */
export const COMPANY = {
  ready: false,
  /** The company's legal name. */
  name: "[Company legal name]",
  /** Country of registration: its law governs the terms. */
  country: "[Country of registration]",
  address: "[Registered address]",
  /** Read by a person: legal, privacy and takedown requests come here. */
  email: "[legal@your-domain]",
};

/** When the texts last changed (shown on each page). */
export const LEGAL_UPDATED = "October 7, 2026";

export const LEGAL_PAGES: SiteLink[] = [
  { href: "/terms", label: "Terms of service" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/takedown", label: "Copyright and takedowns" },
];
