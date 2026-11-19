import type { KnowledgeEntryDto, KnowledgeStatus, KnowledgeView } from "@hub/contract/knowledge";

/** The View menu of Knowledge, in order, with its words (P70). */
export const VIEW_ORDER: readonly KnowledgeView[] = ["all", "attention", "expired", "unapproved"];
export const VIEW_LABEL: Record<KnowledgeView, string> = { all: "All", attention: "Needs a look", expired: "Expired", unapproved: "Not approved" };

/** A status in words, and how it is shown: nothing for approved (the normal case), a badge otherwise. Total over the contract's union. */
export const STATUS_LOOK: Record<KnowledgeStatus, { word: string; badge: "error" | "warning" | null }> = {
  expired: { word: "Expired", badge: "error" },
  unapproved: { word: "Not approved", badge: "warning" },
  expiring: { word: "Expires soon", badge: "warning" },
  approved: { word: "Approved", badge: null },
};

/** An audience as a person says it: `CLIENT` is "client", `PARTNER_LEAD` "partner lead" (the file keeps the code). */
const word = (code: string): string => code.toLowerCase().replaceAll("_", " ");
const plural = (w: string): string => (w.endsWith("s") ? w : `${w}s`);
const andList = (ws: readonly string[]): string => (ws.length <= 1 ? (ws[0] ?? "") : `${ws.slice(0, -1).join(", ")} and ${ws.at(-1) ?? ""}`);
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Who can find it: its audiences, and its brands when they differ; "No audience" when no search could reach it. */
export function forText(e: KnowledgeEntryDto, brands: boolean): string {
  const who = e.audiences.length > 0 ? capital(e.audiences.map(word).join(", ")) : "No audience";
  return brands && e.brands.length > 0 ? `${who} · ${e.brands.join(", ")}` : who;
}

/** What every entry shares, over the whole base (never the view on screen, so a column does not come and go while he types). */
export type Facets = { allApproved: boolean; sameAudiences: readonly string[] | null; brandsDiffer: boolean };

const key = (xs: readonly string[]): string => [...xs].sort().join(",");

export function facetsOf(all: readonly KnowledgeEntryDto[]): Facets {
  const first = all[0];
  const same = first !== undefined && first.audiences.length > 0 && all.every((e) => key(e.audiences) === key(first.audiences));
  return { allApproved: all.every((e) => e.status === "approved"), sameAudiences: same ? first.audiences : null, brandsDiffer: new Set(all.map((e) => key(e.brands))).size > 1 };
}

/**
 * The one line above the table that says what a hidden column would have repeated on every row (UX pass 2026-11-20): "All
 * approved, for clients and leads". Null when nothing is shared. No count: the View menu holds it (`admin-principles.md` rule 10).
 */
export function sharedLine(f: Facets): string | null {
  const parts = [f.allApproved ? "All approved" : null, f.sameAudiences ? `for ${andList(f.sameAudiences.map((a) => plural(word(a))))}` : null].filter((p): p is string => p !== null);
  return parts.length === 0 ? null : capital(`${parts.join(", ")}.`);
}
