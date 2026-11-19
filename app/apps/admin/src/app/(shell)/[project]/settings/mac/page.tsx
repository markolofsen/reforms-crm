import type { Metadata } from "next";
import { MacScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

// P70: an instance pane reached with a project in the address; the shell folds it to `/settings/mac` (`canonicalAddress`).
export const metadata: Metadata = { title: { absolute: pageTitle("settings.mac", null) } };

export default function ProjectMacPage() {
  return <MacScreen />;
}
