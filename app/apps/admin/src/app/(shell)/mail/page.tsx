import type { Metadata } from "next";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("mail.list", null) } };

export default function MailPage() {
  return null;
}
