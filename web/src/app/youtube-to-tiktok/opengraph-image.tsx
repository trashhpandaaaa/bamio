import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio turns YouTube videos into TikTok clips with captions";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["YouTube video in,","TikToks out."], facts: ["AI finds the moments","Cropped to 9:16","No watermark"], caption: "wait for the last part" });
}
