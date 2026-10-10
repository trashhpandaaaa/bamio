import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { PRIVATE_PAGE } from "@/lib/site";
import { DownloadView } from "./download-view";

export const metadata: Metadata = { title: "Download a video", robots: PRIVATE_PAGE };

/**
 * The downloader, for every signed-in account, with or without a plan: paste a link to a video
 * on another site, and save the file (src/lib/server/downloads.ts). Not YouTube.
 */
export default function DownloadPage() {
  return (
    <>
      <AppHeader />
      <DownloadView />
    </>
  );
}
