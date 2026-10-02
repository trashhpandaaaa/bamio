import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio adds word-by-word captions in 100+ languages";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["auto captions,", "word by word."], facts: ["100+ languages", "Pop, Clean, Boxed", "Burned into 1080p"], caption: "every word right on time" });
}
