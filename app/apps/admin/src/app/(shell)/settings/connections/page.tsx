import type { Metadata } from "next";
import { ConnectionsScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: pageTitle("settings.connections", null) };

export default function ConnectionsPage() {
  return <ConnectionsScreen />;
}
