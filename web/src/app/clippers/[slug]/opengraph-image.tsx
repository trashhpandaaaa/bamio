import { formatPrice } from "@/lib/billing/plans";
import { CLIP_PLATFORMS } from "@/lib/campaigns/links";
import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";
import { campaignBySlug } from "@/lib/server/campaigns";

export const alt = "A clipping campaign on Bamio";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

const short = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** A campaign's share image: what it pays, whose it is and its budget. A draft or an unknown address gets the campaigns page's image. */
export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const page = await campaignBySlug((await params).slug).catch(() => null);
  if (!page) {
    return renderOg({ headline: ["get paid to", "clip."], facts: ["Join a campaign", "Post on your own channel", "Earn for every 1,000 views"], caption: "clip it. post it. get paid." });
  }
  const c = page.campaign;
  return renderOg({
    headline: ["earn", formatPrice(c.rateCents), "per 1,000 views"],
    facts: [short(c.brand, 36), `${formatPrice(c.budgetCents)} budget`, short(c.platforms.map((p) => CLIP_PLATFORMS[p].name).join(", "), 44)],
    caption: "clip it. post it. get paid.",
  });
}
