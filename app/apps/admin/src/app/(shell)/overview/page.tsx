import type { Metadata } from "next";
import { OverviewScreen } from "@/features/overview/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("overview.page", null) } };

export default function OverviewPage() {
  return <OverviewScreen />;
}
