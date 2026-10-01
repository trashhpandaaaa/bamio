import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ImportView } from "./import-view";

export const metadata: Metadata = { title: "Import a video" };

/** ?url= fills in the link (from the landing page's form); ?mode=upload opens the upload tab. */
export default async function NewPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const url = typeof params.url === "string" ? params.url.slice(0, 2000) : undefined;
  return (
    <>
      <AppHeader />
      <ImportView initialUrl={url} initialMode={params.mode === "upload" ? "upload" : "link"} />
    </>
  );
}
