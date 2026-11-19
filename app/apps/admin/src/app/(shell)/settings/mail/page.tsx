import type { Metadata } from "next";
import { MailScreen } from "@/features/settings/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("settings.mail", null) } };

export default function MailPage() {
  return <MailScreen />;
}
