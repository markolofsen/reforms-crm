import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BulkScreen } from "@/features/bulk/section";
import { NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { positiveInt } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/bulk/[id]">): Promise<Metadata> {
  const [{ id }, { project }] = await Promise.all([props.params, props.searchParams]);
  if (positiveInt(id) === null) return { title: { absolute: NOT_FOUND_TITLE } };
  return { title: { absolute: pageTitle("bulk.item", typeof project === "string" ? project : null, positiveInt(id) ?? undefined) } };
}

export default async function BatchPage(props: PageProps<"/bulk/[id]">) {
  if (positiveInt((await props.params).id) === null) notFound();
  return <BulkScreen />;
}
