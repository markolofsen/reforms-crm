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

/**
 * P97 S2 (decision 0044, the owner's answer 4 of 2026-11-21): the lead's own words and the address a reply goes to. The carapis
 * backend writes the account email in `Email` and what the person typed on the form in `Details` as a line
 * `Contact channel: Email: <address>` (or `WhatsApp: …`, `Telegram: …`). A typed email wins; else the account email; else none
 * (a phone or Telegram contact gets no mail draft: the card says which channel to use).
 */
export interface LeadDetail extends Lead {
  company: string | null;
  message: string;
  details: string;
  form: string | null;
  pageUrl: string | null;
  phone: string | null;
  /** The reply address (typed email, else `Email`), lower case; null: none. */
  replyTo: string | null;
  /** The contact the person typed when it is not an email ("WhatsApp: 0804291728"), else null. */
  otherContact: string | null;
}

const EMAIL_RE = /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[^\s@<>(),;:"']+$/;
const richOf = (p: PropertyValue | undefined): string => (p?.type === "rich_text" ? plain(p.rich_text) : p?.type === "title" ? plain(p.title) : "");

/** The `Contact channel:` line of Details: `{ email }` when it names an email, `{ other }` for any other channel, null when absent. */
export function contactChannelOf(details: string): { email: string } | { other: string } | null {
  const line = details.split(/\r?\n/).map((l) => l.trim()).find((l) => /^contact\s*channel\s*:/i.test(l));
  if (!line) return null;
  const value = line.replace(/^contact\s*channel\s*:\s*/i, "").trim();
  if (!value) return null;
  const m = /^e-?mail\s*:\s*(\S+)/i.exec(value);
  const addr = (m?.[1] ?? (EMAIL_RE.test(value) ? value : "")).replace(/[.,;]+$/, "").replace(/^<|>$/g, "").toLowerCase();
  if (addr && EMAIL_RE.test(addr)) return { email: addr };
  return { other: value.slice(0, 120) };
}

/** A Leads page with the fields the card and the reply need. Pure. */
export function parseLeadDetail(page: PageObject): LeadDetail {
  const base = parseLeadPage(page);
  const details = richOf(prop(page, "Details"));
  const channel = contactChannelOf(details);
  const account = base.email && EMAIL_RE.test(base.email.trim()) ? base.email.trim().toLowerCase() : null;
  const url = prop(page, "Page URL")?.url;
  const phone = prop(page, "Phone")?.phone_number;
  return {
    ...base,
    company: richOf(prop(page, "Company")).trim() || null,
    message: richOf(prop(page, "Message")),
    details,
    form: richOf(prop(page, "Form")).trim() || null,
    pageUrl: typeof url === "string" ? url : null,
    phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
    replyTo: channel && "email" in channel ? channel.email : account,
    otherContact: channel && "other" in channel ? channel.other : null,
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
