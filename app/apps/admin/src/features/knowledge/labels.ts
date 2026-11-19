import type { KnowledgeEntryDto, KnowledgeStatus, KnowledgeView } from "@hub/contract/knowledge";

/** The View menu of Knowledge, in order, with its words (P70). */
export const VIEW_ORDER: readonly KnowledgeView[] = ["all", "attention", "expired", "unapproved"];
export const VIEW_LABEL: Record<KnowledgeView, string> = { all: "All", attention: "Needs a look", expired: "Expired", unapproved: "Not approved" };

/** A status in words, and whether it is a problem (shown in the warning tone). Total over the contract's union. */
export const STATUS_LOOK: Record<KnowledgeStatus, { word: string; problem: boolean }> = {
  expired: { word: "Expired", problem: true },
  unapproved: { word: "Not approved", problem: true },
  expiring: { word: "Expires soon", problem: true },
  approved: { word: "Approved", problem: false },
};

/** Who can find it: its audiences, and its brands in a by-brand project; "No audience" when no search could reach it. */
export function forText(e: KnowledgeEntryDto, byBrand: boolean): string {
  const who = e.audiences.length > 0 ? e.audiences.join(", ") : "No audience";
  return byBrand && e.brands.length > 0 ? `${who} · ${e.brands.join(", ")}` : who;
}
