import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { positiveInt } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/mail/c/[id]">): Promise<Metadata> {
  const id = positiveInt((await props.params).id);
  return { title: { absolute: id === null ? NOT_FOUND_TITLE : pageTitle("mail.conversation", null, id) } };
}

export default async function ConversationPage(props: PageProps<"/mail/c/[id]">) {
  if (positiveInt((await props.params).id) === null) notFound();
  return null;
}
