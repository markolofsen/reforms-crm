import type { Metadata } from "next";
import { AgentsScreen } from "@/features/agents/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("agents.page", null) } };

export default function AgentsPage() {
  return <AgentsScreen />;
}
