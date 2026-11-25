import type { Metadata } from "next";
import { WatchScreen } from "@/features/watch/section";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/watch">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: pageTitle("watch.page", addressedProject(project)) };
}

export default function WatchPage() {
  return <WatchScreen />;
}
