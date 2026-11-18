import type { Metadata } from "next";
import { ActivityScreen } from "@/features/log/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/log">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("log.list", decodeURIComponent(project)) } };
}

export default function ProjectActivityPage() {
  return <ActivityScreen />;
}
