import { LEAD_PASS_PREFETCH_EARLIER, LEAD_PASS_DECISION_LABELS } from "@hub/config/lead-pass";
import type { LeadRow, Repos } from "@hub/db";
import type { LeadDetail } from "@hub/notion";
import type { ProjectConfig } from "@hub/projects/model";
import { leadNotes } from "../mail/lead-notes";

// The prefetch of one lead turn (decision 0055, P147 verdict 5): the lead's Notion page (every intake field), the Hub's checks
// (`lead-notes`), the identity match (D2: only an exact reply address counts; D1: the card's Relationship), the brand and the
// person's earlier requests with their decisions, rendered as the prompt's data block. No other person's text. Nothing writes.

export interface LeadPrefetchDeps {
  repos: Repos;
  project: (slug: string) => ProjectConfig | undefined;
  /** The Leads reader's live read of one page (absent, or Notion refused: the block says so and the turn decides from the row). */
  page?: ((slug: string, pageId: string) => Promise<{ lead: LeadDetail } | { note: string }>) | undefined;
  /** The Notion Relationship of the Clients card with this email, as the server's directory holds it (D1), else null. */
  relationship?: ((slug: string, email: string) => string | null) | undefined;
}

const cut = (s: string | null | undefined, n: number) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export async function leadPrefetch(d: LeadPrefetchDeps, slug: string, row: LeadRow): Promise<{ context: string }> {
  const read = d.page ? await d.page(slug, row.pageId).catch(() => ({ note: "Notion could not show this lead now" })) : { note: "Notion Leads are not read here" };
  const lead = "lead" in read ? read.lead : null;
  const notes = await leadNotes(d.repos, slug, row, lead?.sheet ?? null).catch(() => []);
  const cfg = d.project(slug);
  const brand = row.brand && cfg?.brands.some((b) => b.name.toLowerCase() === row.brand?.toLowerCase()) ? row.brand : null;
  const exact = row.email ? await d.repos.clients.findByIdentity(slug, "email", row.email) : undefined;
  const client = exact === undefined ? null : await d.repos.clients.get(slug, exact);
  const drafts = client ? await d.repos.drafts.ofClient(slug, client.id) : [];
  const relationship = row.email ? (d.relationship?.(slug, row.email) ?? null) : null;
  const earlier = await d.repos.leadPass.earlier(slug, row.pageId, LEAD_PASS_PREFETCH_EARLIER);
  const out = [
    `Lead ${row.pageId}: ${cut(row.name, 120)}. Reply address: ${row.email ?? "none (a phone or Telegram only)"}${row.accountEmail && row.accountEmail !== row.email ? `; site account email ${row.accountEmail}` : ""}.`,
    `Received ${row.receivedAt}. Notion Status: ${row.notionStatus ?? "empty (New)"}.`,
    brand ? `Brand: ${brand} (a ## Brands row of project ${slug}: sign and answer as it).` : `Brand: none resolved${row.brand ? ` ("${cut(row.brand, 60)}" is not a ## Brands row)` : ""}: decide hand_over, reason "no brand".`,
    `Form facts: site ${row.site ?? "none"}, country ${row.country ?? "?"}, segment ${row.segment ?? "?"}, volume ${row.volume ?? "?"}.`,
    lead ? `Company: ${cut(lead.company, 120) || "not given"}. Contact: ${lead.otherContact ?? lead.replyTo ?? "?"}${lead.phone ? `; phone ${lead.phone}` : ""}.` : `The page was not read (${"note" in read ? read.note : "?"}): the request is the 120-character preview below.`,
    ...(lead ? ["The form, every field:", ...lead.sheet.fields.map((f) => `- ${f.label}: ${cut(f.value, 400)}`), ...(lead.message ? [`Message: ${cut(lead.message, 1_500)}`] : [])] : [`Request: ${cut(row.preview, 120)}`]),
    ...(notes.length ? ["The Hub's checks:", ...notes.map((n) => `- ${JSON.stringify(n)}`)] : ["The Hub's checks: none."]),
    client
      ? `Exact match: client ${client.id} (${cut(client.name, 80)}) has the email ${row.email}; Notion Relationship ${relationship ?? "unknown"}; ${drafts.length} draft(s) of ours on record${drafts.some((x) => x.status === "sent") ? ", some sent: real correspondence" : ""}. A Relationship of Lead with nothing sent is still reply (D1).`
      : `No client's email is exactly the reply address.${row.hasClient ? " Notion says a Clients card is linked to this lead (often a backfill with Relationship Lead): still reply unless the match is exact." : ""}`,
    ...(earlier.length
      ? ["Earlier requests of this person (newest first):", ...earlier.map((e) => `- ${e.receivedAt.slice(0, 10)} ${cut(e.preview, 120)}${e.passDecision ? ` · decided ${LEAD_PASS_DECISION_LABELS[e.passDecision]}: ${cut(e.passReason, 160)}` : ""}${e.convertedAt ? " · answered" : ""}`)]
      : ["No earlier request from this address."]),
  ];
  return { context: out.join("\n") };
}
