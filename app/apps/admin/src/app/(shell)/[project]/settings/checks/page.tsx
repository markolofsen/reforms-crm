import type { Metadata } from "next";
import { ChecksScreen } from "@/features/settings/section";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/settings/checks">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: pageTitle("settings.checks", addressedProject(project)) };
}

export default function ChecksPage() {
  return <ChecksScreen />;
}
