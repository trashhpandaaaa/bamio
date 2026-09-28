import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ProjectsView } from "./projects-view";

export const metadata: Metadata = { title: "Projects" };

export default function ProjectsPage() {
  return (
    <>
      <AppHeader />
      <ProjectsView />
    </>
  );
}
