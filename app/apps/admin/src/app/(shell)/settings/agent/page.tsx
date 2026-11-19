import type { Metadata } from "next";
import { AgentScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("settings.agent", null) } };

export default function AgentPage() {
  return <AgentScreen />;
}
