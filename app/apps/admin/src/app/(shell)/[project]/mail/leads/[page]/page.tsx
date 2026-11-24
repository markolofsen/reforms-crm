import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addressedProject, NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { notionPage } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/[project]/mail/leads/[page]">): Promise<Metadata> {
  const { page, project } = await props.params;
  return { title: { absolute: notionPage(page) !== null ? pageTitle("mail.lead", addressedProject(project)) : NOT_FOUND_TITLE } };
}

/** One lead of Mail ▸ Leads (P134): the screen is the leads layout's; this page adds only the title, or Not found for a bad id. */
export default async function LeadPage(props: PageProps<"/[project]/mail/leads/[page]">) {
  if (notionPage((await props.params).page) === null) notFound();
  return null;
}
