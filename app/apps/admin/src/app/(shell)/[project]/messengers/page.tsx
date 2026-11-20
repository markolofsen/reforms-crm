import type { Metadata } from "next";
import { ChatsScreen } from "@/features/messengers/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/messengers">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("messengers.page", decodeURIComponent(project)) } };
}

export default function ProjectMessengersPage() {
  return <ChatsScreen />;
}
