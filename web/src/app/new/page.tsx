import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ImportView } from "./import-view";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Import a video", robots: PRIVATE_PAGE };

/** ?url= fills in the link (from the landing page's form); ?mode=upload opens the upload tab; ?trial_card= is Stripe's card check for the free first video, just finished. */
export default async function NewPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const url = typeof params.url === "string" ? params.url.slice(0, 2000) : undefined;
  const returnedCard = typeof params.trial_card === "string" ? params.trial_card.slice(0, 300) : undefined;
  return (
    <>
      <AppHeader />
      <ImportView initialUrl={url} initialMode={params.mode === "upload" ? "upload" : "link"} returnedCard={returnedCard} />
    </>
  );
}
