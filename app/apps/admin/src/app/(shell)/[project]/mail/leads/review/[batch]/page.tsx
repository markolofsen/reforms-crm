import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LeadReviewScreen } from "@/features/mail/leads/review";
import { addressedProject, NOT_FOUND_TITLE, pageTitle } from "@/routes/meta";
import { positiveId } from "@/routes/search";

export async function generateMetadata(props: PageProps<"/[project]/mail/leads/review/[batch]">): Promise<Metadata> {
  const { batch, project } = await props.params;
  return { title: positiveId(batch) !== null ? pageTitle("mail.lead-review", addressedProject(project)) : NOT_FOUND_TITLE };
}

/** Mail ▸ Leads ▸ Review (P147): the day's lead batch, its full texts and its one click; Not found for a bad batch id. */
export default async function LeadReviewPage(props: PageProps<"/[project]/mail/leads/review/[batch]">) {
  if (positiveId((await props.params).batch) === null) notFound();
  return <LeadReviewScreen />;
}
