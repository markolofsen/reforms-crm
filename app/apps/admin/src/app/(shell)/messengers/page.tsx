import type { Metadata } from "next";
import { pageTitle } from "@/routes/meta";

export const metadata: Metadata = { title: { absolute: pageTitle("messengers.page", null) } };

export default function MessengersPage() {
  return null;
}
