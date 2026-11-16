import type { Metadata } from "next";
import { ActivityScreen } from "@/features/log/section";
import { pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/log">): Promise<Metadata> {
  const { project } = await props.searchParams;
  return { title: { absolute: pageTitle("log.list", typeof project === "string" ? project : null) } };
}

export default function ActivityPage() {
  return <ActivityScreen />;
}
