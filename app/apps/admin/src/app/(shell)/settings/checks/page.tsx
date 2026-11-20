import type { Metadata } from "next";
import { ChecksScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("settings.checks", null) } };

export default function ChecksPage() {
  return <ChecksScreen />;
}
