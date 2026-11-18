import type { Metadata } from "next";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/drafts">): Promise<Metadata> {
  const { project } = await props.params;
  return { title: { absolute: pageTitle("drafts.list", decodeURIComponent(project)) } };
}

export default function ProjectDraftsPage() {
  return null;
}
