import type { Metadata } from "next";
import { SetupScreen } from "@/features/project/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("project.setup", null) } };

export default function SetupPage() {
  return <SetupScreen />;
}
