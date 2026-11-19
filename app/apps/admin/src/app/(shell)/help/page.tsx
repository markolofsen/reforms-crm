import type { Metadata } from "next";
import { HelpScreen } from "@/features/help/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("help.page", null) } };

export default function HelpPage() {
  return <HelpScreen />;
}
