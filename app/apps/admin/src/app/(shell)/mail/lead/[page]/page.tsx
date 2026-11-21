import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";

const isPageId = (raw: string) => /^[0-9a-f]{32}$/.test(raw.replace(/-/g, "").toLowerCase());

export async function generateMetadata(props: PageProps<"/mail/lead/[page]">): Promise<Metadata> {
  return { title: { absolute: isPageId((await props.params).page) ? pageTitle("mail.lead", null) : NOT_FOUND_TITLE } };
}

export default async function LeadPage(props: PageProps<"/mail/lead/[page]">) {
  if (!isPageId((await props.params).page)) notFound();
  return null;
}
