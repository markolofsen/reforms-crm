import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addressedProject, NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { clientKeyParam } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/[project]/mail/c/[key]">): Promise<Metadata> {
  const { key, project } = await props.params;
  const k = clientKeyParam(key);
  return { title: { absolute: k === null ? NOT_FOUND_TITLE : pageTitle("mail.conversation", addressedProject(project), k) } };
}

export default async function ConversationPage(props: PageProps<"/[project]/mail/c/[key]">) {
  if (clientKeyParam((await props.params).key) === null) notFound();
  return null;
}
