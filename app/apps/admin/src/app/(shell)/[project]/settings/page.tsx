import type { Metadata } from "next";
import { SendingScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/settings">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("settings.page", decodeURIComponent(project)) } };
}

export default function ProjectSendingPage() {
  return <SendingScreen />;
}
