import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { EditorApp } from "@/components/editor/editor-app";
import type { EditorLevel } from "@/lib/editor/features";
import { editorLevel } from "@/lib/server/editor-access";
import { reportError } from "@/lib/server/monitor";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Editor", robots: PRIVATE_PAGE };

/**
 * The video editor, for every signed-in account: it runs in the browser (src/components/editor,
 * src/lib/editor), so it asks nothing of Bamio's servers but which plan the account has. The
 * basics are free; a plan adds the features in lib/editor/features.ts.
 */
export default async function EditorPage() {
  const { userId } = await auth();
  // The plan couldn't be read: the editor still opens, with the basics.
  const level: EditorLevel = userId
    ? await editorLevel(userId).catch((err: unknown) => {
        reportError(err, "the editor couldn't read the plan");
        return "free" as const;
      })
    : "free";
  return (
    <>
      <AppHeader />
      <Suspense>
        <EditorApp level={level} />
      </Suspense>
    </>
  );
}
