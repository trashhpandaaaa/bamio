import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio turns podcast episodes into captioned vertical clips";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["podcast clips,", "without the scrubbing."], facts: ["Episodes up to 3 hours", "Captions every word", "100+ languages"], caption: "and that's when I knew" });
}
