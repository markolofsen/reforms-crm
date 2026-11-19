import type { Metadata } from "next";
import { SetupScreen } from "@/features/project/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/project/setup">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("project.setup", decodeURIComponent(project)) } };
}

export default function ProjectSetupPage() {
  return <SetupScreen />;
}
