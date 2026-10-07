import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { BillingView } from "./billing-view";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Plan & billing", robots: PRIVATE_PAGE };

/** ?checkout=done: back from Stripe Checkout. ?changed=1: back from switching plans in the billing portal. ?trial_card=: back from the free trial's card check. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  return (
    <>
      <AppHeader />
      <BillingView arrived={params.checkout === "done" ? "checkout" : params.changed ? "changed" : null} returnedCard={typeof params.trial_card === "string" ? params.trial_card.slice(0, 300) : undefined} />
    </>
  );
}
