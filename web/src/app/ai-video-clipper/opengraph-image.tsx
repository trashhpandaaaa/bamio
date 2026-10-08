import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio is an AI video clipper that finds the best moments of long videos";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["the AI video clipper that finds","the hook."], facts: ["A score for every clip","Word-by-word captions","1080p, no watermark"], caption: "the moment it all clicked" });
}
