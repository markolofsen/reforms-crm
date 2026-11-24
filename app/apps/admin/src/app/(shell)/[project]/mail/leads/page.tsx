import type { Metadata } from "next";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/mail/leads">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: pageTitle("mail.leads", addressedProject(project)) };
}

export default function LeadsPage() {
  return null;
}
