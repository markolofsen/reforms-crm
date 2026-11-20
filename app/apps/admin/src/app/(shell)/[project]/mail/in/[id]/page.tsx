import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { positiveInt } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/[project]/mail/in/[id]">): Promise<Metadata> {
  const { id, project } = await props.params;
  const n = positiveInt(id);
  return { title: { absolute: n === null ? NOT_FOUND_TITLE : pageTitle("mail.inbound", decodeURIComponent(project), n) } };
}

export default async function ProjectInboundPage(props: PageProps<"/[project]/mail/in/[id]">) {
  if (positiveInt((await props.params).id) === null) notFound();
  return null;
}
