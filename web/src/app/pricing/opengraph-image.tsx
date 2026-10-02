import { formatPrice, PLANS } from "@/lib/billing/plans";
import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio pricing: Starter, Pro and Team plans";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({
    headline: ["pick a plan,", "start clipping."],
    facts: [`From ${formatPrice(PLANS.starter.price.month)} a month`, "1080p, no watermark", "Cancel any time"],
    caption: "three clips from one episode",
  });
}
