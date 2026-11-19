import type { Metadata } from "next";
import { KnowledgeScreen } from "@/features/knowledge/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("knowledge.page", null) } };

export default function KnowledgePage() {
  return <KnowledgeScreen />;
}
