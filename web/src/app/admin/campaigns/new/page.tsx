import type { Metadata } from "next";
import Link from "next/link";
import { REQUEST_KINDS } from "@/lib/campaigns/schema";
import { requireAdmin } from "@/lib/server/admin";
import { adminCampaignRequest } from "@/lib/server/campaign-requests";
import { PRIVATE_PAGE } from "@/lib/site";
import { AdminShell } from "../../admin-shell";
import { CampaignForm } from "../campaign-controls";
import styles from "../../admin.module.css";

export const metadata: Metadata = { title: "New campaign · Admin", robots: PRIVATE_PAGE };

/**
 * A new clipping campaign. It starts as a draft: nobody sees it until it goes live.
 * ?request=<id>: made from someone's request to run a campaign (the form on /clippers): the
 * form starts from what they said, and making the draft answers their request.
 */
export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const admin = await requireAdmin();
  const asked = (await searchParams).request;
  const request = typeof asked === "string" && /^\d{1,12}$/.test(asked) ? await adminCampaignRequest(Number(asked)) : null;
  const open = request?.status === "pending" ? request : null;

  return (
    <AdminShell admin={admin} title="New campaign" lede="It starts as a draft only admins see. Look it over on its page, then open it.">
      {request && !open ? (
        <p className={styles.alert}>
          {request.name}’s request has already been answered.{" "}
          <Link className={styles.cellLink} href="/admin/campaigns">
            Back to Campaigns
          </Link>
        </p>
      ) : null}
      {open ? (
        <p className={styles.note}>
          From {open.name}’s request ({REQUEST_KINDS[open.kind]}
          {open.email ? `, ${open.email}` : ""}). The form starts from what they said: write the title and the one line, add rules, and check the rate and budget. They’re
          emailed when the campaign goes live.
        </p>
      ) : null}
      <CampaignForm
        request={
          open
            ? { id: open.id, name: open.name, sourceUrl: open.sourceUrl, brief: open.brief, platforms: open.platforms, rateCents: open.rateCents, budgetCents: open.budgetCents, payout: open.payout }
            : undefined
        }
      />
    </AdminShell>
  );
}
