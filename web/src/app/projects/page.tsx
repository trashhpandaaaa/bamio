import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ProjectsView } from "./projects-view";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Projects", robots: PRIVATE_PAGE };

export default function ProjectsPage() {
  return (
    <>
      <AppHeader />
      <ProjectsView />
    </>
  );
}
