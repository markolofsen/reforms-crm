// P97 S4 and S5 (decision 0044 point 4): the Hub's writes on leads, and nothing else. On a lead page it sets exactly `Status`
// (In progress at the first confirmed send, Spam on the owner's click, New on its Undo) and `Client` (the relation to the lead's
// Clients card); in Clients it creates exactly one page per person who had none (Name, Email, Phone, Relationship Lead, Brand
// where the schema has them). Never an intake field, never Owner, Next step or Notes, never a delete. Like `stamp.ts` there is no
// generic page update here. A refusal never reaches the send: the caller stores the note for the owner and logs one line.
import notionhq from "@notionhq/client";
import { notionSdkLog } from "./sdk-log";
import { findClientPages } from "./client-lookup";
import { parseLeadPage } from "./leads";
import type { DataSourceInfo, NotionReader, PageObject, PropertyConfig } from "./types";

export const LEAD_WRITE_STATUSES = ["In progress", "Spam", "New"] as const;
export type LeadWriteStatus = (typeof LEAD_WRITE_STATUSES)[number];

export interface LeadWriter {
  /** `Status` of one lead page, as the data source types it (select or status). */
  setStatus(pageId: string, property: { name: string; type: "select" | "status" }, value: LeadWriteStatus): Promise<void>;
  /** `Client` of one lead page: exactly this one Clients page. */
  linkClient(leadPageId: string, relation: string, clientPageId: string): Promise<void>;
  /** One new Clients page with these property values; returns its id. */
  createClient(clientsDataSource: string, properties: Record<string, unknown>): Promise<string>;
  /** The lead page itself (its `Client` and `Status` now). Optional: without it the caller's stored facts are used. */
  retrieveLead?(pageId: string): Promise<PageObject>;
}

export function createLeadWriter(token: string, options: { fetch?: typeof fetch } = {}): LeadWriter {
  const client = new notionhq.Client({ auth: token, timeoutMs: 30_000, retry: { maxRetries: 2, initialRetryDelayMs: 1000, maxRetryDelayMs: 10_000 }, ...notionSdkLog, ...(options.fetch ? { fetch: options.fetch as never } : {}) });
  return {
    async setStatus(pageId, property, value) {
      await client.pages.update({ page_id: pageId, properties: { [property.name]: property.type === "status" ? { status: { name: value } } : { select: { name: value } } } as never });
    },
    async linkClient(leadPageId, relation, clientPageId) {
      await client.pages.update({ page_id: leadPageId, properties: { [relation]: { relation: [{ id: clientPageId }] } } as never });
    },
    async createClient(clientsDataSource, properties) {
      const r = (await client.pages.create({ parent: { data_source_id: clientsDataSource }, properties: properties as never })) as { id: string };
      return r.id;
    },
    async retrieveLead(pageId) {
      return (await client.pages.retrieve({ page_id: pageId })) as unknown as PageObject;
    },
  };
}

/** Notion's status and code of a failed call (never its message: it can quote a property value). */
export function notionFailure(e: unknown): { status: number | null; code: string | null } {
  const status: unknown = e && typeof e === "object" ? Reflect.get(e, "status") : undefined;
  const code: unknown = e && typeof e === "object" ? Reflect.get(e, "code") : undefined;
  return { status: typeof status === "number" ? status : null, code: typeof code === "string" ? code : null };
}
const refused = (e: unknown) => {
  const f = notionFailure(e);
  return f.status === 403 || f.code === "restricted_resource" || f.status === 401;
};

const optionNames = (c: PropertyConfig | undefined): string[] => {
  if (!c) return [];
  const o = c[c.type] as { options?: Array<{ name?: unknown }> } | undefined;
  return Array.isArray(o?.options) ? o.options.map((x) => (typeof x.name === "string" ? x.name : "")).filter(Boolean) : [];
};

/** The lead data source's `Status` property, when it is a select or a status that has the option `value`; else why not. */
export function statusProperty(ds: DataSourceInfo, value: LeadWriteStatus): { name: string; type: "select" | "status" } | { missing: string } {
  const c = ds.properties["Status"];
  if (!c || (c.type !== "select" && c.type !== "status")) return { missing: "the Leads database has no Status (select) property" };
  if (!optionNames(c).includes(value)) return { missing: `the Leads Status has no option "${value}"` };
  return { name: "Status", type: c.type };
}

export type StatusOutcome = { state: "written"; status: LeadWriteStatus } | { state: "skipped"; reason: string } | { state: "refused"; note: string };

/** S5: Spam on the owner's click, New on its Undo (and S4's In progress). Reads the data source once for the property's type. */
export async function writeLeadStatus(deps: { reader: NotionReader; writer: LeadWriter }, o: { leadsDataSource: string; pageId: string; status: LeadWriteStatus }): Promise<StatusOutcome> {
  const ds = await deps.reader.retrieveDataSource(o.leadsDataSource);
  const p = statusProperty(ds, o.status);
  if ("missing" in p) return { state: "skipped", reason: p.missing };
  try {
    await deps.writer.setStatus(o.pageId, p, o.status);
    return { state: "written", status: o.status };
  } catch (e) {
    if (refused(e)) return { state: "refused", note: "Notion did not let the Hub change the lead's Status: give the hub integration Update content (Notion ▸ the integration's Capabilities)" };
    throw e;
  }
}

export interface ConvertInput {
  leadsDataSource: string;
  clientsDataSource: string;
  leadPageId: string;
  /** The address the reply went to (the lead's reply address). */
  email: string;
  /** For a new card: the lead's name, phone and brand (Lead.Brand), as read. */
  name: string;
  phone?: string | null;
  brand?: string | null;
  /** What the Hub stored about the lead (used when the writer cannot read the page itself). */
  stored?: { hasClient: boolean; status: string | null };
}

export type ConvertOutcome = {
  /** The Clients card the lead is linked to now (linked before, linked now, or created now), or null. */
  clientPageId: string | null;
  card: "already_linked" | "linked" | "created" | "several" | "not_created" | "refused";
  status: "in_progress" | "kept" | "skipped" | "refused";
  /** The owner's Needs-you line when something was not done; null when all went through. */
  note: string | null;
};

const titleOf = (ds: DataSourceInfo): string | null => Object.entries(ds.properties).find(([, c]) => c.type === "title")?.[0] ?? null;

/** The properties of a new Clients page: only those the data source has, with their own types (verdict 5 case d). Pure. */
export function newClientProperties(ds: DataSourceInfo, l: { name: string; email: string; phone?: string | null; brand?: string | null }): Record<string, unknown> | null {
  const title = titleOf(ds);
  if (!title) return null;
  const props: Record<string, unknown> = { [title]: { title: [{ type: "text", text: { content: (l.name.trim() || l.email).slice(0, 200) } }] } };
  if (ds.properties["Email"]?.type === "email") props["Email"] = { email: l.email };
  if (l.phone && ds.properties["Phone"]?.type === "phone_number") props["Phone"] = { phone_number: l.phone.slice(0, 60) };
  const rel = ds.properties["Relationship"];
  if (rel && (rel.type === "select" || rel.type === "status") && optionNames(rel).includes("Lead")) props["Relationship"] = rel.type === "status" ? { status: { name: "Lead" } } : { select: { name: "Lead" } };
  const brand = ds.properties["Brand"];
  if (l.brand && brand) {
    const known = optionNames(brand).find((n) => n.toLowerCase() === l.brand?.toLowerCase());
    if (known && brand.type === "multi_select") props["Brand"] = { multi_select: [{ name: known }] };
    if (known && brand.type === "select") props["Brand"] = { select: { name: known } };
  }
  return props;
}

/**
 * Verdict 5, at the first confirmed send of a draft to a lead: (a) the lead already has a Client: nothing to link; (b) exactly one
 * Clients card has the address: link it; (c) several: link none, say so; (d) none: create one (Relationship Lead) and link it.
 * An existing card is never changed (a Client or Prospect is never lowered). Then the lead's Status New (or empty) becomes In
 * progress; Won, Lost or Spam stay. A 403 is a note for the owner, never thrown; any other failure is thrown to the caller.
 */
export async function convertLead(deps: { reader: NotionReader; writer: LeadWriter }, o: ConvertInput): Promise<ConvertOutcome> {
  const notes: string[] = [];
  const leadsDs = await deps.reader.retrieveDataSource(o.leadsDataSource);
  const relation = Object.entries(leadsDs.properties).find(([n, c]) => n === "Client" && c.type === "relation")?.[0] ?? null;
  const page = deps.writer.retrieveLead ? await deps.writer.retrieveLead(o.leadPageId) : null;
  const lead = page ? parseLeadPage(page) : null;
  const linkedId = page ? ((page.properties["Client"]?.relation as Array<{ id?: string }> | undefined)?.[0]?.id ?? null) : null;
  const hasClient = lead ? lead.hasClient : (o.stored?.hasClient ?? false);
  const status = lead ? lead.status : ((o.stored?.status ?? null) as string | null);

  let clientPageId: string | null = linkedId;
  let card: ConvertOutcome["card"] = "already_linked";
  if (!hasClient) {
    const pages = await findClientPages(deps.reader, o.clientsDataSource, o.email);
    if (pages.length > 1) {
      card = "several";
      notes.push(`${pages.length} Clients cards have ${o.email}: link the right one to the lead in Notion`);
    } else {
      let target = pages[0]?.id ?? null;
      card = target ? "linked" : "created";
      if (!target) {
        const clientsDs = await deps.reader.retrieveDataSource(o.clientsDataSource);
        const props = newClientProperties(clientsDs, { name: o.name, email: o.email, phone: o.phone ?? null, brand: o.brand ?? null });
        if (!props) {
          card = "not_created";
          notes.push("the Clients database has no title property: the Hub cannot create a card");
        } else {
          try {
            target = await deps.writer.createClient(o.clientsDataSource, props);
          } catch (e) {
            if (!refused(e)) throw e;
            card = "refused";
            notes.push(`Notion did not let the Hub create ${o.name}'s Clients card: give the hub integration Insert content, or ask the dock to create the card`);
          }
        }
      }
      if (target && relation) {
        try {
          await deps.writer.linkClient(o.leadPageId, relation, target);
          clientPageId = target;
        } catch (e) {
          if (!refused(e)) throw e;
          clientPageId = target;
          notes.push(`Notion did not let the Hub link ${o.name} to the Clients card: give the hub integration Update content`);
        }
      } else if (target) {
        clientPageId = target;
        notes.push("the Leads database has no Client relation: the card is not linked to the lead");
      }
    }
  }

  let st: ConvertOutcome["status"] = "kept";
  if (status === null || status === "New") {
    const r = await writeLeadStatus(deps, { leadsDataSource: o.leadsDataSource, pageId: o.leadPageId, status: "In progress" });
    st = r.state === "written" ? "in_progress" : r.state === "refused" ? "refused" : "skipped";
    if (r.state === "refused") notes.push(r.note);
    if (r.state === "skipped") notes.push(`the lead's Status was not set: ${r.reason}`);
  }
  return { clientPageId, card, status: st, note: notes.length ? notes.join("; ") : null };
}
