import type { Metadata } from "next";
import { BulkScreen } from "@/features/bulk/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/bulk">): Promise<Metadata> {
  const { project } = await props.searchParams;
  return { title: { absolute: pageTitle("bulk.list", typeof project === "string" ? project : null) } };
}

export default function BulkPage() {
  return <BulkScreen />;
}
