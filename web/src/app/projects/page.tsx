import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ProjectsView } from "./projects-view";

export const metadata: Metadata = { title: "Your videos" };

export default function ProjectsPage() {
  return (
    <>
      <AppHeader />
      <main id="main">
        <ProjectsView />
      </main>
    </>
  );
}
