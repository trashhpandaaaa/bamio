import { OG_SIZE, OG_TYPE, renderOg } from "@/lib/og";

export const alt = "Bamio clips Twitch and Kick streams while they're live";
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return renderOg({ headline: ["clip your stream", "while it's live."], facts: ["Twitch, Kick, YouTube", "Back to the start", "Captions as it goes"], caption: "no way that just happened" });
}
