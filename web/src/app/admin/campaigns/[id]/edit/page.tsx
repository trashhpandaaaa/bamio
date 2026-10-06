import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/server/admin";
import { adminCampaign } from "@/lib/server/campaigns";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "../../../admin-shell";
import { CampaignForm } from "../../campaign-controls";

export const metadata: Metadata = { title: "Edit campaign · Admin", robots: PRIVATE_PAGE };

/** Change a campaign's words and terms. A new rate or budget applies to every clip at once, those already counted too. */
export default async function EditCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const found = await adminCampaign((await params).id);
  if (!found) notFound();
  return (
    <AdminShell
      admin={admin}
      title={`Edit “${found.campaign.title}”`}
      lede="A new rate, minimum or budget applies to every clip at once, those already counted too. Tell clippers before changing a live campaign."
    >
      <CampaignForm campaign={found.campaign} />
    </AdminShell>
  );
}
