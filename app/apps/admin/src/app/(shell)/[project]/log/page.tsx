import type { Metadata } from "next";
import { ActivityScreen } from "@/features/log/section";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/log">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: pageTitle("log.list", addressedProject(project)) };
}

export default function ActivityPage() {
  return <ActivityScreen />;
}
