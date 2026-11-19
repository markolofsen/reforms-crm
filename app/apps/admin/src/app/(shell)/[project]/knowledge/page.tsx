import type { Metadata } from "next";
import { KnowledgeScreen } from "@/features/knowledge/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/knowledge">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("knowledge.page", decodeURIComponent(project)) } };
}

export default function ProjectKnowledgePage() {
  return <KnowledgeScreen />;
}
