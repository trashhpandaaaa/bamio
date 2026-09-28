import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ClipEditor } from "./clip-editor";

export const metadata: Metadata = { title: "Edit clip" };

export default async function ClipPage(props: PageProps<"/projects/[id]/clips/[clipId]">) {
  const { id, clipId } = await props.params;
  return (
    <>
      <AppHeader />
      <ClipEditor projectId={id} clipId={clipId} />
    </>
  );
}
