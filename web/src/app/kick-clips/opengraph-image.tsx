import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio turns Kick streams into vertical clips with captions";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["Kick stream in,","clips out."], facts: ["Live or past broadcasts","Captions as it goes","No watermark"], caption: "chat is not ready for this" });
}
