import type { MetadataRoute } from "next";
import { TOKENS } from "@/lib/brand-tokens";
import { HOME_DESCRIPTION, SITE_NAME } from "@/lib/site";

/** /manifest.webmanifest: the name, colours and icons for "add to home screen" and app listings. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME}: AI clip maker`,
    short_name: SITE_NAME,
    description: HOME_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: TOKENS.paper["--bg"],
    theme_color: TOKENS.brand["--ink"],
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
