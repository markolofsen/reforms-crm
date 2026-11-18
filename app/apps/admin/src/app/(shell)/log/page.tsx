import type { Metadata } from "next";
import { ActivityScreen } from "@/features/log/section";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("log.list", null) } };

export default function ActivityPage() {
  return <ActivityScreen />;
}
