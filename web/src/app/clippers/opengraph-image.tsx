import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio's Clippers page: the people who clip with Bamio";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({
    headline: ["meet the", "clippers."],
    facts: ["Streams, podcasts and long videos", "Find a clipper for your channel", "Clip with Bamio? Add yourself"],
    caption: "the people who clip with Bamio",
  });
}
