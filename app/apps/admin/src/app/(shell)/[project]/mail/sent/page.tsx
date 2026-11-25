import type { Metadata } from "next";
import { SentScreen } from "@/features/mail/sent";
import { addressedProject, pageTitle } from "@/routes/meta";

export async function generateMetadata(props: PageProps<"/[project]/mail/sent">): Promise<Metadata> {
  return { title: pageTitle("mail.sent", addressedProject((await props.params).project)) };
}

/** Mail ▸ Sent (P147 3m item 3): every send of the project, newest first, with its full text. */
export default function SentPage() {
  return <SentScreen />;
}
