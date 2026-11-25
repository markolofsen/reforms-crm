// P97 S4 and S5 (decision 0044 point 4): the Hub's writes on leads, and nothing else. On a lead page it sets exactly `Status`
// (In progress at the first confirmed send, Spam on the owner's click, New on its Undo) and `Client` (the relation to the lead's
// Clients card); in Clients it creates exactly one page per person who had none (Name, Email, Phone, Relationship Lead, Projects
// where the schema has them) and adds the lead's project to a card it links (P145, decision 0053: added, never removed). Never an
// intake field, never Owner, Next step or Notes, never a delete. Like `stamp.ts` there is no generic page update here. A refusal
// never reaches the send: the caller stores the note for the owner and logs one line.
// P147 (decision 0055 point 5, verdict 8): the profile fill at the send. A card it creates also gets Company, Site, Country,
// Segment and Volume from the lead where the schema has them; a card it links gets only the empty ones of those, never
// overwritten (`fillProfile`, the one narrow write). A lead the pass matched to a client (`card`, D3) is linked to that card.
import notionhq from "@notionhq/client";
import { optionForKey, projectsWithKey } from "@hub/projects/brands";
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
  /** One page (the lead with its `Client` and `Status` now, or a Clients card). Optional: without it the caller's stored facts are used. */
  retrievePage?(pageId: string): Promise<PageObject>;
  /** `Projects` of one Clients card: exactly these options (the card's own plus one; decision 0053 point 4). */
  setProjects?(pageId: string, property: string, options: readonly string[]): Promise<void>;
  /** P147: the empty profile properties of one Clients card (Company, Site, Country, Segment, Volume), exactly these values. */
  fillProfile?(pageId: string, properties: Record<string, unknown>): Promise<void>;
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
    async retrievePage(pageId) {
      return (await client.pages.retrieve({ page_id: pageId })) as unknown as PageObject;
    },
    async setProjects(pageId, property, options) {
      await client.pages.update({ page_id: pageId, properties: { [property]: { multi_select: options.map((name) => ({ name })) } } as never });
    },
    async fillProfile(pageId, properties) {
      const names = Object.keys(properties).filter((n) => (PROFILE_FIELDS as readonly string[]).includes(n) || n === "Website");
      if (names.length) await client.pages.update({ page_id: pageId, properties: Object.fromEntries(names.map((n) => [n, properties[n]])) as never });
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

/** The Clients (and Documents, Contacts, Tasks, Expenses, Bug reports) property that holds a record's project keys (decision 0053). */
export const PROJECTS = "Projects";

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
  /** P147 verdict 8: the lead's profile facts for the card (create: all the schema has; link: the empty ones only). */
  profile?: LeadProfile | null;
  /** P147 D3: the Clients card of the client the pass matched by the exact reply address; linked instead of a lookup. */
  card?: string | null;
}

/** P147: the five profile facts of a lead the send writes on its Clients card. */
export interface LeadProfile {
  company: string | null;
  site: string | null;
  country: string | null;
  segment: string | null;
  volume: string | null;
}
export const PROFILE_FIELDS = ["Company", "Site", "Country", "Segment", "Volume"] as const;

/** One profile value in the property's own type; a select takes only an option that exists (never a new one); else null. Pure. */
function profileValue(c: PropertyConfig | undefined, value: string | null): unknown {
  const v = value?.trim();
  if (!c || !v) return null;
  if (c.type === "rich_text") return { rich_text: [{ type: "text", text: { content: v.slice(0, 500) } }] };
  if (c.type === "url") return /^https?:\/\//i.test(v) ? { url: v.slice(0, 500) } : { url: `https://${v.slice(0, 490)}` };
  if (c.type === "select") {
    const name = optionNames(c).find((o) => o.toLowerCase() === v.toLowerCase());
    return name ? { select: { name } } : null;
  }
  if (c.type === "multi_select") {
    const name = optionNames(c).find((o) => o.toLowerCase() === v.toLowerCase());
    return name ? { multi_select: [{ name }] } : null;
  }
  return null;
}

/** The profile properties the Clients schema has for these facts (Site, else Website), each in its own type. Pure. */
export function profileProperties(ds: DataSourceInfo, p: LeadProfile): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const put = (name: string, value: string | null) => {
    const v = profileValue(ds.properties[name], value);
    if (v !== null) out[name] = v;
  };
  put("Company", p.company);
  if (ds.properties["Site"]) put("Site", p.site);
  else put("Website", p.site);
  put("Country", p.country);
  put("Segment", p.segment);
  put("Volume", p.volume);
  return out;
}

/** Whether one property of a page holds nothing (an empty text, url, select or multi-select). */
const emptyOn = (page: PageObject, name: string): boolean => {
  const p = page.properties[name] as Record<string, unknown> | undefined;
  if (!p) return true;
  const v = p[p.type as string];
  if (v === null || v === undefined || v === "") return true;
  return Array.isArray(v) && v.length === 0;
};

/** P147 verdict 8: on a card the Hub linked, fill only the empty profile properties. A 403 is a note; null when done or nothing to do. */
export async function fillEmptyProfile(deps: { reader: NotionReader; writer: LeadWriter }, o: { clientsDataSource: string; pageId: string; profile: LeadProfile }): Promise<string | null> {
  if (!deps.writer.retrievePage || !deps.writer.fillProfile) return null;
  const ds = await deps.reader.retrieveDataSource(o.clientsDataSource);
  const want = profileProperties(ds, o.profile);
  if (!Object.keys(want).length) return null;
  const page = await deps.writer.retrievePage(o.pageId);
  const empty = Object.fromEntries(Object.entries(want).filter(([n]) => emptyOn(page, n)));
  if (!Object.keys(empty).length) return null;
  try {
    await deps.writer.fillProfile(o.pageId, empty);
    return null;
  } catch (e) {
    if (!refused(e)) throw e;
    return "Notion did not let the Hub fill the client's empty profile fields: give the hub integration Update content";
  }
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
export function newClientProperties(ds: DataSourceInfo, l: { name: string; email?: string | null; phone?: string | null; brand?: string | null; profile?: LeadProfile | null }): Record<string, unknown> | null {
  const title = titleOf(ds);
  if (!title) return null;
  // P141 C3: a chat-only client has no Email; its title is the caller's (a real name, else the channel placeholder), never empty.
  const props: Record<string, unknown> = { [title]: { title: [{ type: "text", text: { content: (l.name.trim() || l.email || "").slice(0, 200) } }] } };
  if (l.email && ds.properties["Email"]?.type === "email") props["Email"] = { email: l.email };
  if (l.phone && ds.properties["Phone"]?.type === "phone_number") props["Phone"] = { phone_number: l.phone.slice(0, 60) };
  const rel = ds.properties["Relationship"];
  if (rel && (rel.type === "select" || rel.type === "status") && optionNames(rel).includes("Lead")) props["Relationship"] = rel.type === "status" ? { status: { name: "Lead" } } : { select: { name: "Lead" } };
  // P145 (decision 0053): the lead's project is the Clients option with the same key; none or two: nothing, never a new option.
  const projects = ds.properties[PROJECTS];
  const known = l.brand && projects?.type === "multi_select" ? optionForKey(optionNames(projects), l.brand) : null;
  if (known) props[PROJECTS] = { multi_select: [{ name: known }] };
  // P147 verdict 8: the lead's profile facts the schema has (never the title, Email, Phone or Relationship written above).
  if (l.profile) for (const [n, v] of Object.entries(profileProperties(ds, l.profile))) if (!(n in props)) props[n] = v;
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
  const page = deps.writer.retrievePage ? await deps.writer.retrievePage(o.leadPageId) : null;
  const lead = page ? parseLeadPage(page) : null;
  const linkedId = page ? ((page.properties["Client"]?.relation as Array<{ id?: string }> | undefined)?.[0]?.id ?? null) : null;
  const hasClient = lead ? lead.hasClient : (o.stored?.hasClient ?? false);
  const status = lead ? lead.status : ((o.stored?.status ?? null) as string | null);

  // P147 verdict 8: the form's Company (read from the page when it can be) completes the stored facts.
  const companyOf = (p: PageObject | null) => ((p?.properties["Company"]?.rich_text as Array<{ plain_text?: string }> | undefined) ?? []).map((t) => t.plain_text ?? "").join("").trim() || null;
  const profile = o.profile ? { ...o.profile, company: o.profile.company ?? companyOf(page) } : null;
  let clientPageId: string | null = linkedId;
  let card: ConvertOutcome["card"] = "already_linked";
  if (!hasClient) {
    // P147 D3: the pass matched this lead to a client by the exact reply address: that client's card, never a duplicate.
    const pages = o.card ? [{ id: o.card }] : await findClientPages(deps.reader, o.clientsDataSource, o.email);
    if (pages.length > 1) {
      card = "several";
      notes.push(`${pages.length} Clients cards have ${o.email}: link the right one to the lead in Notion`);
    } else {
      let target = pages[0]?.id ?? null;
      card = target ? "linked" : "created";
      if (!target) {
        const clientsDs = await deps.reader.retrieveDataSource(o.clientsDataSource);
        const props = newClientProperties(clientsDs, { name: o.name, email: o.email, phone: o.phone ?? null, brand: o.brand ?? null, profile });
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

  if (clientPageId && (card === "already_linked" || card === "linked") && o.brand) {
    const note = await addProjectToCard(deps, { clientsDataSource: o.clientsDataSource, pageId: clientPageId, project: o.brand });
    if (note) notes.push(note);
  }
  if (clientPageId && (card === "already_linked" || card === "linked") && profile) {
    const note = await fillEmptyProfile(deps, { clientsDataSource: o.clientsDataSource, pageId: clientPageId, profile });
    if (note) notes.push(note);
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

/**
 * P145 9a (decision 0053 point 4): a known client who arrives for another project gets that project's option in `Projects`, added
 * to the ones the card has and never removing one (Notion replaces a multi_select whole, so the card is read first). Only an
 * option that exists with the same key; none or two: nothing (Notion would make a new option). A 403 is a note; null when done
 * or nothing to do.
 */
export async function addProjectToCard(deps: { reader: NotionReader; writer: LeadWriter }, o: { clientsDataSource: string; pageId: string; project: string }): Promise<string | null> {
  if (!deps.writer.retrievePage || !deps.writer.setProjects) return null;
  const ds = await deps.reader.retrieveDataSource(o.clientsDataSource);
  const config = ds.properties[PROJECTS];
  if (config?.type !== "multi_select") return null;
  const page = await deps.writer.retrievePage(o.pageId);
  const current = ((page.properties[PROJECTS]?.multi_select as Array<{ name?: unknown }> | undefined) ?? []).map((x) => (typeof x.name === "string" ? x.name : "")).filter(Boolean);
  const next = projectsWithKey(current, optionNames(config), o.project);
  if (!next) return null;
  try {
    await deps.writer.setProjects(o.pageId, PROJECTS, next);
    return null;
  } catch (e) {
    if (!refused(e)) throw e;
    return `Notion did not let the Hub add ${o.project} to the client's Projects: give the hub integration Update content`;
  }
}
