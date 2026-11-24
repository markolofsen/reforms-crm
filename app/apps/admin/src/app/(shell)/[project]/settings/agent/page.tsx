import type { Metadata } from "next";
import { AgentScreen } from "@/features/settings/section";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/settings/agent">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: pageTitle("settings.agent", addressedProject(project)) };
}

export default function AgentSettingsPage() {
  return <AgentScreen />;
}
