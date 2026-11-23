import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addressedProject, NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";

const isPageId = (raw: string) => /^[0-9a-f]{32}$/.test(raw.replace(/-/g, "").toLowerCase());

export async function generateMetadata(props: PageProps<"/[project]/mail/lead/[page]">): Promise<Metadata> {
  const { page, project } = await props.params;
  return { title: { absolute: isPageId(page) ? pageTitle("mail.lead", addressedProject(project)) : NOT_FOUND_TITLE } };
}

export default async function LeadPage(props: PageProps<"/[project]/mail/lead/[page]">) {
  if (!isPageId((await props.params).page)) notFound();
  return null;
}
