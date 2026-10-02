import type { Metadata } from "next";
import { AppHeader } from "@/components/app-header";
import { ProjectView } from "./project-view";
import { PRIVATE_PAGE } from "@/lib/site";

export const metadata: Metadata = { title: "Project", robots: PRIVATE_PAGE };

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  return (
    <>
      <AppHeader />
      <ProjectView id={id} />
    </>
  );
}
