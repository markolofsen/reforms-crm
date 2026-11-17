// Leads, the one place core understands them: a lead is a row of the project's `leads` database (Notion pack module "Leads"), written by the
// owner's own backend (e.g. django_notion), the website form or the mail agent, and handled by people. This file only reads. The contract with the
// writers is @docs/core/21-leads.md; the field list is `app/projects/_template/notion-crm/schema/leads.json`.
import type { PageObject, PropertyValue } from "./types";

export const LEAD_STATUSES = ["New", "In progress", "Won", "Lost", "Spam"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface Lead {
  id: string;
  name: string;
  /** null = the Status cell is empty: handled as New, like the live "Inbox" view does. */
  status: LeadStatus | null;
  source: string | null;
  brands: string[];
  /** ISO date or datetime. */
  receivedAt: string | null;
  nextStep: string | null;
  email: string | null;
  hasClient: boolean;
}

const prop = (page: PageObject, name: string): PropertyValue | undefined => page.properties[name];
const plain = (v: unknown): string => (Array.isArray(v) ? v.map((t) => (typeof t === "object" && t && "plain_text" in t ? String((t as { plain_text: unknown }).plain_text) : "")).join("") : "");
const sel = (p: PropertyValue | undefined): string | null => {
  const o = p?.[p?.type ?? ""] as { name?: unknown } | null | undefined;
  return o && typeof o.name === "string" ? o.name : null;
};
const dateOf = (p: PropertyValue | undefined): string | null => {
  const o = p?.date as { start?: unknown } | null | undefined;
  return o && typeof o.start === "string" ? o.start : null;
};

/** A Notion page of the Leads database as a Lead. Unknown properties are ignored; a missing one is null/empty. */
export function parseLeadPage(page: PageObject): Lead {
  const status = sel(prop(page, "Status"));
  const brandsRaw = prop(page, "Brand")?.multi_select;
  const rel = prop(page, "Client")?.relation;
  const email = prop(page, "Email")?.email;
  return {
    id: page.id,
    name: plain(Object.values(page.properties).find((p) => p.type === "title")?.title) || "(no name)",
    status: (LEAD_STATUSES as readonly string[]).includes(status ?? "") ? (status as LeadStatus) : null,
    source: sel(prop(page, "Source")),
    brands: Array.isArray(brandsRaw) ? brandsRaw.map((b) => String((b as { name?: unknown }).name ?? "")).filter(Boolean) : [],
    receivedAt: dateOf(prop(page, "Received at")),
    nextStep: dateOf(prop(page, "Next step")),
    email: typeof email === "string" ? email : null,
    hasClient: Array.isArray(rel) && rel.length > 0,
  };
}

export interface LeadSummary {
  total: number;
  byStatus: Record<string, number>;
  byBrand: Record<string, number>;
  bySource: Record<string, number>;
  /** New (or no status) and received before today: the "Needs reply" view. Oldest first. */
  needsReply: Lead[];
  /** In progress with a Next step date before today. Oldest first. */
  overdue: Lead[];
  /** Won with no Client linked: the "Won, no client" view. */
  wonNoClient: Lead[];
}

const day = (iso: string): string => iso.slice(0, 10);
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1; };

/** `today` is a YYYY-MM-DD in the owner's calendar; the caller decides which one. Pure. */
export function summarizeLeads(leads: Lead[], today: string): LeadSummary {
  const s: LeadSummary = { total: leads.length, byStatus: {}, byBrand: {}, bySource: {}, needsReply: [], overdue: [], wonNoClient: [] };
  for (const l of leads) {
    bump(s.byStatus, l.status ?? "New");
    bump(s.bySource, l.source ?? "(none)");
    for (const b of l.brands.length ? l.brands : ["(none)"]) bump(s.byBrand, b);
    if ((l.status === null || l.status === "New") && l.receivedAt && day(l.receivedAt) < today) s.needsReply.push(l);
    if (l.status === "In progress" && l.nextStep && day(l.nextStep) < today) s.overdue.push(l);
    if (l.status === "Won" && !l.hasClient) s.wonNoClient.push(l);
  }
  const old = (a: Lead, b: Lead) => (a.receivedAt ?? "").localeCompare(b.receivedAt ?? "");
  s.needsReply.sort(old);
  s.wonNoClient.sort(old);
  s.overdue.sort((a, b) => (a.nextStep ?? "").localeCompare(b.nextStep ?? ""));
  return s;
}

const counts = (m: Record<string, number>): string => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

export function renderLeadSummary(s: LeadSummary): string {
  const rows = (title: string, ls: Lead[]) => (ls.length ? [`${title} (${ls.length}):`, ...ls.slice(0, 20).map((l) => `  ${day(l.receivedAt ?? "")}  ${l.name}${l.email ? ` <${l.email}>` : ""}${l.brands.length ? `  [${l.brands.join(", ")}]` : ""}`), ...(ls.length > 20 ? [`  ... ${ls.length - 20} more`] : [])] : []);
  return [
    `leads: ${s.total}`,
    `status: ${counts(s.byStatus)}`,
    `brand: ${counts(s.byBrand)}`,
    `source: ${counts(s.bySource)}`,
    ...rows("needs reply (new, received before today)", s.needsReply),
    ...rows("overdue next step (in progress)", s.overdue),
    ...rows("won, no client linked", s.wonNoClient),
  ].join("\n") + "\n";
}
