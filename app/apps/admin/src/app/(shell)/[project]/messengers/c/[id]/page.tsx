import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addressedProject, NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { positiveInt } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/[project]/messengers/c/[id]">): Promise<Metadata> {
  const { id: rawId, project } = await props.params;
  const id = positiveInt(rawId);
  return { title: id === null ? NOT_FOUND_TITLE : pageTitle("messengers.conversation", addressedProject(project), id) };
}

export default async function MessengerConversationPage(props: PageProps<"/[project]/messengers/c/[id]">) {
  if (positiveInt((await props.params).id) === null) notFound();
  return null;
}
