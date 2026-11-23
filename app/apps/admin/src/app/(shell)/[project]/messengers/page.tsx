import type { Metadata } from "next";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/messengers">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("messengers.page", addressedProject(project)) } };
}

export default function MessengersPage() {
  return null;
}
