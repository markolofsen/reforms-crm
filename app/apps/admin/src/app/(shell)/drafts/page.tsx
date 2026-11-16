import type { Metadata } from "next";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/drafts">): Promise<Metadata> {
  const { project } = await props.searchParams;
  return { title: { absolute: pageTitle("drafts.list", typeof project === "string" ? project : null) } };
}

export default function DraftsPage() {
  return null;
}
