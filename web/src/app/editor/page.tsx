import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { EditorApp } from "@/components/editor/editor-app";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Editor", robots: PRIVATE_PAGE };

/**
 * The video editor, for every signed-in account, with or without a plan: it runs in the
 * browser (src/components/editor, src/lib/editor), so it asks nothing of Bamio's servers.
 */
export default function EditorPage() {
  return (
    <>
      <AppHeader />
      <Suspense>
        <EditorApp />
      </Suspense>
    </>
  );
}
