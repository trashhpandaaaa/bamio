import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { Workspace } from "./workspace";

export const metadata: Metadata = { title: "Edit video" };

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  return (
    <>
      <AppHeader />
      <main id="main">
        {/* The active tab lives in ?tab=, read with useSearchParams. */}
        <Suspense fallback={null}>
          <Workspace id={id} />
        </Suspense>
      </main>
    </>
  );
}
