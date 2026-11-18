import type { Metadata } from "next";
import { ProjectScreen } from "@/features/project/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/project">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("project.page", decodeURIComponent(project)) } };
}

export default function ProjectProjectPage() {
  return <ProjectScreen />;
}
