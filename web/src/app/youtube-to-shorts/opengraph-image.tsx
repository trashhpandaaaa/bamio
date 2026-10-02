import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio turns YouTube videos into Shorts with AI-picked moments and captions";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["YouTube video in,", "Shorts out."], facts: ["AI finds the moments", "9:16 in a drag", "No watermark"], caption: "the moment it all clicked" });
}
