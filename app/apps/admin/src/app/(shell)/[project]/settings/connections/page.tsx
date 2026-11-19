import type { Metadata } from "next";
import { ConnectionsScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

// P70: an instance pane reached with a project in the address; the shell folds it to `/settings/connections` (`canonicalAddress`).
export const metadata: Metadata = { title: { absolute: pageTitle("settings.connections", null) } };

export default function ProjectConnectionsPage() {
  return <ConnectionsScreen />;
}
