import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ImportView } from "./import-view";

export const metadata: Metadata = { title: "Import a video" };

export default function NewPage() {
  return (
    <>
      <AppHeader />
      <ImportView />
    </>
  );
}
