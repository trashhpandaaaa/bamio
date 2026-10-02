import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ClipEditor } from "./clip-editor";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Edit clip", robots: PRIVATE_PAGE };

export default async function ClipPage(props: PageProps<"/projects/[id]/clips/[clipId]">) {
  const { id, clipId } = await props.params;
  return (
    <>
      <AppHeader />
      <ClipEditor projectId={id} clipId={clipId} />
    </>
  );
}
