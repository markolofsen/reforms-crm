import type { Metadata } from "next";
import { ProjectScreen } from "@/features/project/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("project.page", null) } };

export default function ProjectPage() {
  return <ProjectScreen />;
}
