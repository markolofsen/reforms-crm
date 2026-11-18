import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { positiveInt } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/[project]/drafts/[id]">): Promise<Metadata> {
  const { id, project } = await props.params;
  const n = positiveInt(id);
  return { title: { absolute: n === null ? NOT_FOUND_TITLE : pageTitle("drafts.item", decodeURIComponent(project), n) } };
}

export default async function ProjectDraftPage(props: PageProps<"/[project]/drafts/[id]">) {
  if (positiveInt((await props.params).id) === null) notFound();
  return null;
}
