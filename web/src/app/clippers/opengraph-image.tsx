import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Clipping campaigns on Bamio: get paid per view for your clips";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({
    headline: ["get paid to", "clip."],
    facts: ["Join a campaign", "Post on your own channel", "Earn for every 1,000 views"],
    caption: "clip it. post it. get paid.",
  });
}
