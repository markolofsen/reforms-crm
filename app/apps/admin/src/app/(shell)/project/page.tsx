import type { Metadata } from "next";
import { ProjectScreen } from "@/features/project/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/project">): Promise<Metadata> {
  const { project } = await props.searchParams;
  return { title: { absolute: pageTitle("project.page", typeof project === "string" ? project : null) } };
}

export default function ProjectPage() {
  return <ProjectScreen />;
}
