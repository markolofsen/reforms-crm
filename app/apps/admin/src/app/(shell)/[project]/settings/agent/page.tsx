import type { Metadata } from "next";
import { AgentScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/settings/agent">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("settings.agent", decodeURIComponent(project)) } };
}

export default function ProjectAgentPage() {
  return <AgentScreen />;
}
