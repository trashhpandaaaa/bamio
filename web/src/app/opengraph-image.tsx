import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio turns long videos into vertical shorts with word-by-word captions";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["long video in,", "shorts out."], facts: ["AI finds the moments", "Captions every word", "100+ languages"], caption: "here's the part nobody tells you" });
}
