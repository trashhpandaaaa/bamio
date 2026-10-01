import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { BillingView } from "./billing-view";

export const metadata: Metadata = { title: "Plan & billing" };

/** ?checkout=done: back from Stripe Checkout. ?changed=1: back from switching plans in the billing portal. */
export default async function BillingPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  return (
    <>
      <AppHeader />
      <BillingView arrived={params.checkout === "done" ? "checkout" : params.changed ? "changed" : null} />
    </>
  );
}
