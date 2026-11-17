import type { Metadata } from "next";
import { ConnectionsScreen } from "@/features/connections/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("connections.page", null) } };

export default function ConnectionsPage() {
  return <ConnectionsScreen />;
}
