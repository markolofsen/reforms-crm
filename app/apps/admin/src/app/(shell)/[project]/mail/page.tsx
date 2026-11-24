import type { Metadata } from "next";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/mail">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: pageTitle("mail.list", addressedProject(project)) };
}

export default function MailPage() {
  return null;
}
