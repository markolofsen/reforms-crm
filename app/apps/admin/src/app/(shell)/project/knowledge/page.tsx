import type { Metadata } from "next";
import { KnowledgeScreen } from "@/features/project/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("project.knowledge", null) } };

export default function KnowledgePage() {
  return <KnowledgeScreen />;
}
