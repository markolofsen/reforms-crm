import type { Metadata } from "next";
import { SendingScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("settings.page", null) } };

export default function SendingPage() {
  return <SendingScreen />;
}
