import type { Metadata } from "next";
import { AgentsScreen } from "@/features/agents/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/agents">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("agents.page", decodeURIComponent(project)) } };
}

export default function ProjectAgentsPage() {
  return <AgentsScreen />;
}
