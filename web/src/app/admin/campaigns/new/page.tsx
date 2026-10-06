import type { Metadata } from "next";
import { requireAdmin } from "@/lib/server/admin";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "../../admin-shell";
import { CampaignForm } from "../campaign-controls";

export const metadata: Metadata = { title: "New campaign · Admin", robots: PRIVATE_PAGE };

/** A new clipping campaign. It starts as a draft: nobody sees it until it goes live. */
export default async function NewCampaignPage() {
  const admin = await requireAdmin();
  return (
    <AdminShell admin={admin} title="New campaign" lede="It starts as a draft only admins see. Look it over on its page, then open it.">
      <CampaignForm />
    </AdminShell>
  );
}
