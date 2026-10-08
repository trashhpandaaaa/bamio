import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio turns gaming streams into vertical clips with captions";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["hours of gameplay,","the best minute."], facts: ["Finds the loud moments","Face cam or gameplay","Clip while live"], caption: "no way that just happened" });
}
