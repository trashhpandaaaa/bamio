import type { Metadata } from "next";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { CreateFlow } from "./create-flow";

export const metadata: Metadata = { title: "New video" };

export default function NewPage() {
  return (
    <>
      <AppHeader />
      <main id="main">
        {/* useSearchParams (template preselect) needs a Suspense boundary for static rendering. */}
        <Suspense fallback={null}>
          <CreateFlow />
        </Suspense>
      </main>
    </>
  );
}
