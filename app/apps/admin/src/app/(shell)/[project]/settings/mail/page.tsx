import type { Metadata } from "next";
import { MailScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/settings/mail">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("settings.mail", decodeURIComponent(project)) } };
}

export default function ProjectMailPage() {
  return <MailScreen />;
}
