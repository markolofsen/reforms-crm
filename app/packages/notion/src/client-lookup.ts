import { parseLeadDetail } from "./leads";
import type { NotionReader, PageObject, PropertyValue } from "./types";

/**
 * P87: is this address a client of the project's Notion Clients data source? Read only: the data source's properties, then one
 * filtered query over its email-typed properties (and a rich-text property named like "Other emails"). A row marked `Synthetic`
 * (the mail chain check's test records) or `Do not contact` does not count, as in the server's client directory (P84).
 * `draft_write`'s new thread asks it before it writes to an address the project has never recorded.
 */
export type ClientLookup = { state: "client"; pageId: string } | { state: "not_client" } | { state: "do_not_contact"; pageId: string };

const OTHER_EMAILS = /^(other|more|alt(ernative)?)\s*e-?mails?$/i;

const checked = (p: PropertyValue | undefined): boolean => p?.type === "checkbox" && p.checkbox === true;

export const textOf = (p: PropertyValue | undefined): string => {
  if (!p) return "";
  if (p.type === "email") return typeof p.email === "string" ? p.email : "";
  if (p.type === "rich_text" && Array.isArray(p.rich_text)) return (p.rich_text as Array<{ plain_text?: unknown }>).map((x) => (typeof x.plain_text === "string" ? x.plain_text : "")).join("");
  return "";
};

/** Whether a page names the address in one of the properties the query looked at (Notion's `contains` is a substring). */
const names = (page: PageObject, props: readonly string[], email: string): boolean =>
  props.some((k) => textOf(page.properties[k]).toLowerCase().split(/[\s,;]+/).map((x) => x.replace(/^<|>$/g, "")).includes(email));

export async function findClientByEmail(reader: NotionReader, dataSourceId: string, address: string): Promise<ClientLookup> {
  const r = await findClientPage(reader, dataSourceId, address);
  return r.state === "not_client" ? r : { state: r.state, pageId: r.page.id };
}

/** `findClientByEmail` with the page itself (P90: its `Last sent at` / `Last sent by` are read from it, no second request). */
export async function findClientPage(reader: NotionReader, dataSourceId: string, address: string): Promise<{ state: "client" | "do_not_contact"; page: PageObject } | { state: "not_client" }> {
  const email = address.trim().toLowerCase();
  const ds = await reader.retrieveDataSource(dataSourceId);
  const props = Object.entries(ds.properties).flatMap(([name, c]) => (c.type === "email" ? [{ name, type: "email" }] : c.type === "rich_text" && OTHER_EMAILS.test(name) ? [{ name, type: "rich_text" }] : []));
  if (props.length === 0) return { state: "not_client" };
  const filter = { or: props.map((p) => (p.type === "email" ? { property: p.name, email: { equals: email } } : { property: p.name, rich_text: { contains: email } })) };
  const pages = reader.findPages ? await reader.findPages(dataSourceId, filter, 10) : await all(reader, dataSourceId);
  const hits = pages.filter((p) => names(p, props.map((x) => x.name), email) && !checked(p.properties["Synthetic"]));
  const live = hits.find((p) => !checked(p.properties["Do not contact"]));
  if (live) return { state: "client", page: live };
  const dnc = hits[0];
  return dnc ? { state: "do_not_contact", page: dnc } : { state: "not_client" };
}

async function all(reader: NotionReader, dataSourceId: string): Promise<PageObject[]> {
  const out: PageObject[] = [];
  for await (const p of reader.listPages(dataSourceId)) out.push(p);
  return out;
}

/**
 * P97 S3 (decision 0044 point 2): is this address a lead of the project's Notion Leads data source? A row counts when its `Email`
 * (the account email) or the email typed in its `Details` (`Contact channel: Email: …`) is the address, and its Status is not
 * Spam. Read only: the data source's properties, then one filtered query. Returns the newest matching page.
 */
export type LeadLookup = { state: "lead"; pageId: string } | { state: "not_lead" };

export async function findLeadByEmail(reader: NotionReader, dataSourceId: string, address: string): Promise<LeadLookup> {
  const email = address.trim().toLowerCase();
  const ds = await reader.retrieveDataSource(dataSourceId);
  const or: unknown[] = [];
  if (ds.properties["Email"]?.type === "email") or.push({ property: "Email", email: { equals: email } });
  if (ds.properties["Details"]?.type === "rich_text") or.push({ property: "Details", rich_text: { contains: email } });
  if (or.length === 0) return { state: "not_lead" };
  const pages = reader.findPages ? await reader.findPages(dataSourceId, { or }, 20) : await all(reader, dataSourceId);
  const hits = pages
    .map(parseLeadDetail)
    .filter((l) => l.status !== "Spam" && (l.replyTo === email || (l.email ?? "").trim().toLowerCase() === email))
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
  const hit = hits[0];
  return hit ? { state: "lead", pageId: hit.id } : { state: "not_lead" };
}

/** Every live (not Synthetic) Clients page naming the address, Do not contact included: S4 links exactly one and names several. */
export async function findClientPages(reader: NotionReader, dataSourceId: string, address: string): Promise<PageObject[]> {
  const email = address.trim().toLowerCase();
  const ds = await reader.retrieveDataSource(dataSourceId);
  const props = Object.entries(ds.properties).flatMap(([name, c]) => (c.type === "email" ? [{ name, type: "email" }] : c.type === "rich_text" && OTHER_EMAILS.test(name) ? [{ name, type: "rich_text" }] : []));
  if (props.length === 0) return [];
  const filter = { or: props.map((p) => (p.type === "email" ? { property: p.name, email: { equals: email } } : { property: p.name, rich_text: { contains: email } })) };
  const pages = reader.findPages ? await reader.findPages(dataSourceId, filter, 10) : await all(reader, dataSourceId);
  return pages.filter((p) => names(p, props.map((x) => x.name), email) && !checked(p.properties["Synthetic"]));
}
