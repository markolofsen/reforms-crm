import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { positiveInt } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/messengers/c/[id]">): Promise<Metadata> {
  const id = positiveInt((await props.params).id);
  return { title: { absolute: id === null ? NOT_FOUND_TITLE : pageTitle("messengers.conversation", null, id) } };
}

export default async function MessengerConversationPage(props: PageProps<"/messengers/c/[id]">) {
  if (positiveInt((await props.params).id) === null) notFound();
  return null;
}
