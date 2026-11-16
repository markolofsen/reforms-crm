import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { positiveInt } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/drafts/[id]">): Promise<Metadata> {
  const [{ id }, { project }] = await Promise.all([props.params, props.searchParams]);
  if (positiveInt(id) === null) return { title: { absolute: NOT_FOUND_TITLE } };
  return { title: { absolute: pageTitle("drafts.item", typeof project === "string" ? project : null, positiveInt(id) ?? undefined) } };
}

export default async function DraftPage(props: PageProps<"/drafts/[id]">) {
  if (positiveInt((await props.params).id) === null) notFound();
  return null;
}
