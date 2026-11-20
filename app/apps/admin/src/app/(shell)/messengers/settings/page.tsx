import type { Metadata } from "next";
import { MessengerSettingsScreen } from "@/features/messengers/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("messengers.settings", null) } };

export default function MessengerSettingsPage() {
  return <MessengerSettingsScreen />;
}
