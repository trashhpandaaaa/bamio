import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio turns long videos into Instagram Reels with captions";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["long video in,","Reels out."], facts: ["AI finds the moments","9:16, 1:1 or 16:9","Captions burned in"], caption: "this is the part to post" });
}
