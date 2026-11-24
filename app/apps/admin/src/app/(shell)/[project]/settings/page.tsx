import type { Metadata } from "next";
import { SendingScreen } from "@/features/settings/section";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/settings">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: pageTitle("settings.page", addressedProject(project)) };
}

export default function SendingPage() {
  return <SendingScreen />;
}
