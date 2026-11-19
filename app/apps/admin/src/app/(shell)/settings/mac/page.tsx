import type { Metadata } from "next";
import { MacScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("settings.mac", null) } };

export default function MacPage() {
  return <MacScreen />;
}
