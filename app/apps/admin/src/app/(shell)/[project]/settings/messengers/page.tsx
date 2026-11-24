import type { Metadata } from "next";
import { MessengerSettingsScreen } from "@/features/settings/section";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/settings/messengers">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: pageTitle("settings.messengers", addressedProject(project)) };
}

export default function MessengerSettingsPage() {
  return <MessengerSettingsScreen />;
}
