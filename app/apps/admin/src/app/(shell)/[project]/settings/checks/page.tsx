import type { Metadata } from "next";
import { ChecksScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/settings/checks">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("settings.checks", decodeURIComponent(project)) } };
}

export default function ProjectChecksPage() {
  return <ChecksScreen />;
}
