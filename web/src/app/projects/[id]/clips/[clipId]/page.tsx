import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import type { ClipLevel } from "@/lib/clips/features";
import { clipLevel } from "@/lib/server/clip-access";
import { ClipEditor } from "./clip-editor";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Edit clip", robots: PRIVATE_PAGE };

export default async function ClipPage(props: PageProps<"/projects/[id]/clips/[clipId]">) {
  const { id, clipId } = await props.params;
  // The plan decides which of the clip controls are open (lib/clips/features.ts). The server
  // refuses the rest anyway; this is so the page says so before anyone waits for a render.
  const { userId } = await auth();
  const level: ClipLevel = userId ? await clipLevel(userId) : "free";
  return (
    <>
      <AppHeader />
      <ClipEditor projectId={id} clipId={clipId} level={level} />
    </>
  );
}
