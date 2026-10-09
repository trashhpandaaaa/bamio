import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio's free video editor runs in the browser: nothing is uploaded";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["edit in your browser,", "keep it on your device."], facts: ["Nothing uploaded", "No watermark", "Free to edit and export"], caption: "cut the silences out" });
}
