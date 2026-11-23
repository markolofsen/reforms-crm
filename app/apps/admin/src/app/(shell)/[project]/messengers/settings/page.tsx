import type { Metadata } from "next";
import { MessengerSettingsScreen } from "@/features/messengers/section";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/messengers/settings">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("messengers.settings", addressedProject(project)) } };
}

export default function MessengerSettingsPage() {
  return <MessengerSettingsScreen />;
}
