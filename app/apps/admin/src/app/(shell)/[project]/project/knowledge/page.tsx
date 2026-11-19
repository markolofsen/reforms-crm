import type { Metadata } from "next";
import { KnowledgeScreen } from "@/features/project/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/project/knowledge">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("project.knowledge", decodeURIComponent(project)) } };
}

export default function ProjectKnowledgePage() {
  return <KnowledgeScreen />;
}
