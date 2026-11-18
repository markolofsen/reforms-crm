import type { Metadata } from "next";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("drafts.list", null) } };

export default function DraftsPage() {
  return null;
}
