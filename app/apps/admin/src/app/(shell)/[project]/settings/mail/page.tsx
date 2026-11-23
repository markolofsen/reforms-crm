import type { Metadata } from "next";
import { MailScreen } from "@/features/settings/section";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/settings/mail">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("settings.mail", addressedProject(project)) } };
}

export default function MailSettingsPage() {
  return <MailScreen />;
}
