import type { Metadata } from "next";
import { KnowledgeScreen } from "@/features/knowledge/section";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/knowledge">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: pageTitle("knowledge.page", addressedProject(project)) };
}

export default function KnowledgePage() {
  return <KnowledgeScreen />;
}
